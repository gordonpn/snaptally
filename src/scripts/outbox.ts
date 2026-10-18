/**
 * Outbox item representing an un-synced transaction.
 */
export interface OutboxItem {
  id: string;
  date: string;
  card: string;
  parent_bucket: string;
  subcategory: string;
  merchant: string;
  gross_amount: number;
  reimbursement: number;
  created_at: string;
  retry_count?: number;
  rollback_retry_count?: number;
  next_retry_at?: number;
}

export interface SyncOptions {
  token?: string;
  force?: boolean;
  onItemSynced?: (item: OutboxItem, serverResponse?: unknown) => void;
  onStatusChange?: (isSyncing: boolean, pendingCount: number) => void;
  onScheduleRetry?: (delayMs: number) => void;
}

export interface SyncResult {
  syncedCount: number;
  failedCount: number;
  unauthorized: boolean;
  lastError?: string;
}

const DB_NAME = "snaptally_db";
const DB_VERSION = 1;
const STORE_NAME = "outbox";
const FALLBACK_STORAGE_KEY = "snaptally_outbox_fallback";
export const MAX_ROLLBACK_RETRIES = 10;

// In-memory fallback for environments without IndexedDB or localStorage
let memoryFallback: OutboxItem[] = [];

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getFallbackItems(): OutboxItem[] {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed as OutboxItem[];
        }
      }
    }
  } catch {
    // Ignore storage restriction
  }
  return [...memoryFallback];
}

function saveFallbackItems(items: OutboxItem[]): void {
  memoryFallback = [...items];
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(items));
    }
  } catch {
    // Ignore storage restriction
  }
}

/**
 * Saves a transaction to the local IndexedDB outbox.
 */
export async function saveOutboxItem(item: OutboxItem): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    const items = getFallbackItems();
    const existingIndex = items.findIndex((i) => i.id === item.id);
    if (existingIndex >= 0) {
      items[existingIndex] = item;
    } else {
      items.push(item);
    }
    saveFallbackItems(items);
  }
}

/**
 * Retrieves all pending transactions from the outbox ordered chronologically.
 */
export async function getOutbox(): Promise<OutboxItem[]> {
  try {
    const db = await openDatabase();
    const items = await new Promise<OutboxItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as OutboxItem[]);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
    return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    const items = getFallbackItems();
    return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
}

/**
 * Returns the current number of pending transactions in the outbox.
 */
export async function getOutboxCount(): Promise<number> {
  const items = await getOutbox();
  return items.length;
}

/**
 * Deletes a synced transaction from the outbox.
 */
export async function deleteOutboxItem(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    const items = getFallbackItems().filter((i) => i.id !== id);
    saveFallbackItems(items);
  }
}

let activeRetryTimer: ReturnType<typeof setTimeout> | undefined;
let activeRetryDeadline: number | undefined;
let registeredSyncTrigger: ((force?: boolean) => void) | undefined;

/**
 * Clears any scheduled automatic retry timer.
 */
export function clearRetryTimer(): void {
  if (activeRetryTimer !== undefined) {
    clearTimeout(activeRetryTimer);
    activeRetryTimer = undefined;
  }
  activeRetryDeadline = undefined;
}

/**
 * Clears all items from the outbox.
 */
export async function clearOutbox(): Promise<void> {
  clearRetryTimer();
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    saveFallbackItems([]);
  }
}

let isSyncInProgress = false;

/**
 * Flushes pending outbox transactions sequentially to POST /api/transactions.
 */
export async function syncOutbox(options: SyncOptions = {}): Promise<SyncResult> {
  if (isSyncInProgress) {
    return { syncedCount: 0, failedCount: 0, unauthorized: false };
  }

  isSyncInProgress = true;
  let syncedCount = 0;
  let failedCount = 0;
  let unauthorized = false;
  let lastError: string | undefined;
  let transportHalted = false;

  try {
    const items = await getOutbox();
    options.onStatusChange?.(true, items.length);

    for (const item of items) {
      if (
        !options.force &&
        ((item.rollback_retry_count ?? 0) > MAX_ROLLBACK_RETRIES ||
          (item.next_retry_at && Date.now() < item.next_retry_at))
      ) {
        continue;
      }

      const payload = {
        id: item.id,
        date: item.date,
        card: item.card,
        parent_bucket: item.parent_bucket,
        subcategory: item.subcategory,
        merchant: item.merchant,
        gross_amount: item.gross_amount,
        reimbursement: item.reimbursement,
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
      }

      try {
        const response = await fetch("/api/transactions", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        if (response.status === 201) {
          const data = (await response.json().catch(() => null)) as unknown;
          await deleteOutboxItem(item.id);
          syncedCount++;
          options.onItemSynced?.(item, data);
          continue;
        }

        if (response.status === 401) {
          unauthorized = true;
          // Halt sync loop to prevent spamming unauthorized requests
          break;
        }

        if (response.status === 400) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          const errorMsg = data?.error || response.statusText || "Validation failed";

          // If the item is a credit/reimbursement (gross_amount < 0) and the backend rejects it
          // specifically because negative amounts are unsupported by an older API version (or rollback),
          // retain it with retry backoff rather than permanently discarding user financial records.
          const isUnsupportedNegativeAmount = item.gross_amount < 0 && /positive/i.test(errorMsg);

          if (isUnsupportedNegativeAmount) {
            const rollbackCount = (item.rollback_retry_count ?? 0) + 1;
            item.rollback_retry_count = rollbackCount;
            if (rollbackCount <= MAX_ROLLBACK_RETRIES) {
              const backoffMs = Math.min(60000, 1000 * 2 ** (rollbackCount - 1));
              item.next_retry_at = Date.now() + backoffMs;
            } else {
              item.next_retry_at = undefined;
            }
            await saveOutboxItem(item);
            failedCount++;
            lastError = errorMsg;
            continue;
          }

          // Permanently invalid payload; remove from outbox to prevent blocking the queue
          await deleteOutboxItem(item.id);
          failedCount++;
          lastError = errorMsg;
          continue;
        }

        // Server error or unexpected status: apply exponential backoff (1s, 2s, 4s, capped at 60s)
        const retryCount = (item.retry_count ?? 0) + 1;
        item.retry_count = retryCount;
        const backoffMs = Math.min(60000, 1000 * 2 ** (retryCount - 1));
        item.next_retry_at = Date.now() + backoffMs;
        await saveOutboxItem(item);
        failedCount++;
        scheduleDueRetry(backoffMs, options, item.next_retry_at);
        transportHalted = true;
        break;
      } catch {
        // Network error / offline: apply exponential backoff (1s, 2s, 4s, capped at 60s)
        const retryCount = (item.retry_count ?? 0) + 1;
        item.retry_count = retryCount;
        const backoffMs = Math.min(60000, 1000 * 2 ** (retryCount - 1));
        item.next_retry_at = Date.now() + backoffMs;
        await saveOutboxItem(item);
        failedCount++;
        scheduleDueRetry(backoffMs, options, item.next_retry_at);
        transportHalted = true;
        break;
      }
    }
  } finally {
    isSyncInProgress = false;
    const remaining = await getOutbox();
    const remainingCount = remaining.length;
    if (remainingCount === 0 || unauthorized) {
      clearRetryTimer();
    } else {
      const activePendingItems = remaining.filter(
        (item) => (item.rollback_retry_count ?? 0) <= MAX_ROLLBACK_RETRIES,
      );

      if (transportHalted) {
        // When transport fails (network offline or 5xx), the failed item has already scheduled
        // its backoff. Untouched tail items in the queue (whether without a deadline or retaining
        // an expired deadline from an earlier attempt) must not preempt the backoff.
        const futureDeadlines = activePendingItems
          .map((item) => item.next_retry_at)
          .filter(
            (time): time is number =>
              typeof time === "number" && !Number.isNaN(time) && time > Date.now(),
          );

        if (futureDeadlines.length > 0) {
          const nextDue = Math.min(...futureDeadlines);
          const delayMs = Math.max(0, nextDue - Date.now());
          if (
            activeRetryDeadline === undefined ||
            activeRetryDeadline <= Date.now() ||
            nextDue < activeRetryDeadline
          ) {
            scheduleDueRetry(delayMs, options, nextDue);
          }
        }
      } else {
        const scheduledDeadlines = activePendingItems
          .map((item) => item.next_retry_at)
          .filter((time): time is number => typeof time === "number" && !Number.isNaN(time));

        if (scheduledDeadlines.length > 0) {
          const nextDue = Math.min(...scheduledDeadlines);
          const delayMs = Math.max(0, nextDue - Date.now());
          if (
            activeRetryDeadline === undefined ||
            activeRetryDeadline <= Date.now() ||
            nextDue < activeRetryDeadline
          ) {
            scheduleDueRetry(delayMs, options, nextDue);
          }
        } else if (activePendingItems.length > 0) {
          scheduleDueRetry(0, options, Date.now());
        } else if (activePendingItems.length === 0) {
          clearRetryTimer();
        }
      }
    }
    options.onStatusChange?.(false, remainingCount);
  }

  return { syncedCount, failedCount, unauthorized, lastError };
}

function scheduleDueRetry(delayMs: number, options: SyncOptions, targetDeadline?: number): void {
  const deadline = targetDeadline ?? Date.now() + delayMs;
  if (
    activeRetryDeadline !== undefined &&
    activeRetryDeadline > Date.now() &&
    activeRetryDeadline <= deadline
  ) {
    return;
  }

  clearRetryTimer();
  activeRetryDeadline = deadline;

  if (options.onScheduleRetry) {
    options.onScheduleRetry(delayMs);
  } else if (registeredSyncTrigger) {
    activeRetryTimer = setTimeout(() => {
      activeRetryTimer = undefined;
      activeRetryDeadline = undefined;
      registeredSyncTrigger?.(false);
    }, delayMs);
    activeRetryTimer.unref?.();
  } else {
    activeRetryTimer = setTimeout(() => {
      activeRetryTimer = undefined;
      activeRetryDeadline = undefined;
      void syncOutbox({ ...options, force: false });
    }, delayMs);
    activeRetryTimer.unref?.();
  }
}

/**
 * Registers window event listeners for online and visibilitychange events to trigger sync.
 */
export function setupSyncListeners(triggerSync: (force?: boolean) => void): () => void {
  registeredSyncTrigger = triggerSync;

  if (typeof window === "undefined") {
    return () => {
      clearRetryTimer();
      registeredSyncTrigger = undefined;
    };
  }

  const handleOnline = () => {
    clearRetryTimer();
    triggerSync(true);
  };
  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      triggerSync(false);
    }
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    clearRetryTimer();
    registeredSyncTrigger = undefined;
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}
