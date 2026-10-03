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
let registeredSyncTrigger: ((force?: boolean) => void) | undefined;

/**
 * Clears any scheduled automatic retry timer.
 */
export function clearRetryTimer(): void {
  if (activeRetryTimer !== undefined) {
    clearTimeout(activeRetryTimer);
    activeRetryTimer = undefined;
  }
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

  try {
    const items = await getOutbox();
    options.onStatusChange?.(true, items.length);

    for (const item of items) {
      if (!options.force && item.next_retry_at && Date.now() < item.next_retry_at) {
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
          // Permanently invalid payload; remove from outbox to prevent blocking the queue
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          await deleteOutboxItem(item.id);
          failedCount++;
          lastError = data?.error || response.statusText || "Validation failed";
          continue;
        }

        // Server error or unexpected status: apply exponential backoff (1s, 2s, 4s, capped at 60s)
        const retryCount = (item.retry_count ?? 0) + 1;
        item.retry_count = retryCount;
        const backoffMs = Math.min(60000, 1000 * Math.pow(2, retryCount - 1));
        item.next_retry_at = Date.now() + backoffMs;
        await saveOutboxItem(item);
        failedCount++;
        scheduleDueRetry(backoffMs, options);
        break;
      } catch {
        // Network error / offline: apply exponential backoff (1s, 2s, 4s, capped at 60s)
        const retryCount = (item.retry_count ?? 0) + 1;
        item.retry_count = retryCount;
        const backoffMs = Math.min(60000, 1000 * Math.pow(2, retryCount - 1));
        item.next_retry_at = Date.now() + backoffMs;
        await saveOutboxItem(item);
        failedCount++;
        scheduleDueRetry(backoffMs, options);
        break;
      }
    }
  } finally {
    isSyncInProgress = false;
    const remainingCount = await getOutboxCount();
    if (remainingCount === 0) {
      clearRetryTimer();
    }
    options.onStatusChange?.(false, remainingCount);
  }

  return { syncedCount, failedCount, unauthorized, lastError };
}

function scheduleDueRetry(delayMs: number, options: SyncOptions): void {
  clearRetryTimer();
  if (options.onScheduleRetry) {
    options.onScheduleRetry(delayMs);
  } else if (registeredSyncTrigger) {
    activeRetryTimer = setTimeout(() => {
      activeRetryTimer = undefined;
      registeredSyncTrigger?.(false);
    }, delayMs);
    activeRetryTimer.unref?.();
  } else {
    activeRetryTimer = setTimeout(() => {
      activeRetryTimer = undefined;
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
