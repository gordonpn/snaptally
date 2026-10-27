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
  server_retry_count?: number;
  rollback_retry_count?: number;
  next_retry_at?: number;
}

/**
 * Dead-letter queue item representing a failed or quarantined transaction.
 */
export interface DeadLetterItem {
  id: string;
  payload: OutboxItem;
  error_reason: string;
  http_status?: number;
  failed_at: string;
  retry_count: number;
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
  retryError?: string;
}

const DB_NAME = "snaptally_db";
export const DB_VERSION = 2;
export const STORE_NAME = "outbox";
export const DLQ_STORE_NAME = "dead_letter_queue";
export const FALLBACK_STORAGE_KEY = "snaptally_outbox_fallback";
export const DLQ_FALLBACK_STORAGE_KEY = "snaptally_dlq_fallback";
export const MAX_ROLLBACK_RETRIES = 10;
export const MAX_SYNC_RETRIES = 10;

/** Returns the total transport, server and rollback retries recorded for a transaction. */
export function getRetryCount(item: OutboxItem): number {
  return (
    Math.max(item.retry_count ?? 0, item.server_retry_count ?? 0) + (item.rollback_retry_count ?? 0)
  );
}

// In-memory fallbacks for environments without IndexedDB or localStorage
let memoryFallback: OutboxItem[] = [];
let memoryDlqFallback: DeadLetterItem[] = [];

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
      if (!db.objectStoreNames.contains(DLQ_STORE_NAME)) {
        db.createObjectStore(DLQ_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getFallbackDlqItems(): DeadLetterItem[] {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(DLQ_FALLBACK_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed as DeadLetterItem[];
        }
      }
    }
  } catch {
    // Ignore storage restriction
  }
  return [...memoryDlqFallback];
}

function saveFallbackDlqItems(items: DeadLetterItem[]): void {
  memoryDlqFallback = [...items];
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DLQ_FALLBACK_STORAGE_KEY, JSON.stringify(items));
  }
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
 * Normalizes legacy subcategories in outbox transactions to match the updated taxonomy.
 */
export function normalizeOutboxSubcategory(parentBucket: string, subcategory: string): string {
  if (parentBucket === "Guilt-Free" && subcategory === "Coffee") {
    return "Coffee & Snacks";
  }
  return subcategory;
}

/**
 * Saves a transaction to the local IndexedDB outbox.
 */
export async function saveOutboxItem(item: OutboxItem): Promise<boolean> {
  const normalizedItem: OutboxItem = {
    ...item,
    subcategory: normalizeOutboxSubcategory(item.parent_bucket, item.subcategory),
  };
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(normalizedItem);
      req.onerror = () => {
        if (!settled) {
          settled = true;
          reject(req.error);
        }
      };
      tx.oncomplete = () => {
        db.close();
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      tx.onabort = () => {
        db.close();
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error("Outbox transaction aborted"));
        }
      };
      tx.onerror = () => {
        db.close();
        if (!settled) {
          settled = true;
          reject(tx.error ?? new Error("Outbox transaction error"));
        }
      };
    });
    return true;
  } catch {
    const items = getFallbackItems();
    const existingIndex = items.findIndex((i) => i.id === normalizedItem.id);
    if (existingIndex >= 0) {
      items[existingIndex] = normalizedItem;
    } else {
      items.push(normalizedItem);
    }
    saveFallbackItems(items);
    return false;
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
    return items
      .map((item) => ({
        ...item,
        subcategory: normalizeOutboxSubcategory(item.parent_bucket, item.subcategory),
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    const items = getFallbackItems();
    return items
      .map((item) => ({
        ...item,
        subcategory: normalizeOutboxSubcategory(item.parent_bucket, item.subcategory),
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
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

/**
 * Saves or updates a transaction in the local dead-letter queue.
 */
export async function saveDeadLetterItem(item: DeadLetterItem): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch {
    const items = getFallbackDlqItems();
    const existingIndex = items.findIndex((i) => i.id === item.id);
    if (existingIndex >= 0) {
      items[existingIndex] = item;
    } else {
      items.push(item);
    }
    saveFallbackDlqItems(items);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const tx = db.transaction(DLQ_STORE_NAME, "readwrite");
    const store = tx.objectStore(DLQ_STORE_NAME);
    const req = store.put(item);
    req.onerror = () => {
      if (!settled) {
        settled = true;
        reject(req.error);
      }
    };
    tx.oncomplete = () => {
      db.close();
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    tx.onabort = () => {
      db.close();
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("Transaction aborted"));
      }
    };
    tx.onerror = () => {
      db.close();
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("Transaction error"));
      }
    };
  });
}

/**
 * Quarantines an outbox transaction to the dead-letter queue and removes it from outbox.
 * Returns true if quarantine succeeded, or false if persisting to DLQ failed.
 */
async function quarantineItem(
  item: OutboxItem,
  reason: string,
  httpStatus?: number,
): Promise<boolean> {
  const dlqItem: DeadLetterItem = {
    id: item.id,
    payload: { ...item },
    error_reason: reason,
    http_status: httpStatus,
    failed_at: new Date().toISOString(),
    retry_count: getRetryCount(item),
  };
  try {
    await saveDeadLetterItem(dlqItem);
    await deleteOutboxItem(item.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrieves all quarantined transactions from the dead-letter queue ordered by failure time.
 */
export async function getDeadLetterQueue(): Promise<DeadLetterItem[]> {
  try {
    const db = await openDatabase();
    const items = await new Promise<DeadLetterItem[]>((resolve, reject) => {
      const tx = db.transaction(DLQ_STORE_NAME, "readonly");
      const store = tx.objectStore(DLQ_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as DeadLetterItem[]);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
    return items.sort((a, b) => a.failed_at.localeCompare(b.failed_at));
  } catch {
    const items = getFallbackDlqItems();
    return items.sort((a, b) => a.failed_at.localeCompare(b.failed_at));
  }
}

/**
 * Returns the current number of quarantined transactions in the dead-letter queue.
 */
export async function getDeadLetterCount(): Promise<number> {
  const items = await getDeadLetterQueue();
  return items.length;
}

async function openRecoveryDatabase(id: string): Promise<IDBDatabase | undefined> {
  if (!isIndexedDBAvailable()) return undefined;
  try {
    return await openDatabase();
  } catch (error: unknown) {
    if (!getFallbackDlqItems().some((item) => item.id === id)) throw error;
    return undefined;
  }
}

/**
 * Permanently removes a transaction from the dead-letter queue.
 */
export async function deleteDeadLetterItem(id: string): Promise<void> {
  const db = await openRecoveryDatabase(id);
  if (!db) {
    const items = getFallbackDlqItems().filter((i) => i.id !== id);
    saveFallbackDlqItems(items);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DLQ_STORE_NAME, "readwrite");
    tx.objectStore(DLQ_STORE_NAME).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Discard transaction aborted"));
    };
  });
}

/**
 * Clears all items from the dead-letter queue.
 */
export async function clearDeadLetterQueue(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DLQ_STORE_NAME, "readwrite");
      const store = tx.objectStore(DLQ_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    saveFallbackDlqItems([]);
  }
}

/**
 * Restores a quarantined dead-letter transaction back to the active outbox for retry.
 */
export async function requeueDeadLetterItem(id: string): Promise<void> {
  const db = await openRecoveryDatabase(id);
  const queue = await getDeadLetterQueue();
  const item = queue.find((entry) => entry.id === id);
  if (!item) {
    db?.close();
    return;
  }

  const restoredPayload: OutboxItem = {
    ...item.payload,
    subcategory: normalizeOutboxSubcategory(item.payload.parent_bucket, item.payload.subcategory),
    retry_count: 0,
    server_retry_count: 0,
    rollback_retry_count: 0,
    next_retry_at: undefined,
  };

  if (!db) {
    const original = getFallbackItems();
    const pending = [...original.filter((entry) => entry.id !== id), restoredPayload];
    const failed = getFallbackDlqItems().filter((entry) => entry.id !== id);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(pending));
      try {
        localStorage.setItem(DLQ_FALLBACK_STORAGE_KEY, JSON.stringify(failed));
      } catch (error: unknown) {
        localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(original));
        throw error;
      }
    }
    memoryFallback = pending;
    memoryDlqFallback = failed;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, DLQ_STORE_NAME], "readwrite");
    const failed = tx.objectStore(DLQ_STORE_NAME);
    const request = failed.get(id);
    request.onsuccess = () => {
      if (request.result === undefined) return;
      tx.objectStore(STORE_NAME).put(restoredPayload);
      failed.delete(id);
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Requeue transaction aborted"));
    };
  });
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
  try {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request("snaptally-outbox-sync", () => flushOutbox(options));
    }
    // shortcut: Without Web Locks, sync is per-tab; add a lease if legacy multi-tab support is required.
    return await flushOutbox(options);
  } finally {
    isSyncInProgress = false;
  }
}

async function flushOutbox(options: SyncOptions): Promise<SyncResult> {
  let syncedCount = 0;
  let failedCount = 0;
  let unauthorized = false;
  let lastError: string | undefined;
  let retryError: string | undefined;
  let transportHalted = false;

  try {
    const items = await getOutbox();
    options.onStatusChange?.(true, items.length);

    for (const item of items) {
      if (
        !options.force &&
        (item.server_retry_count ?? 0) >= MAX_SYNC_RETRIES &&
        !(item.next_retry_at && Date.now() < item.next_retry_at)
      ) {
        const quarantined = await quarantineItem(item, "Exceeded maximum retry threshold");
        failedCount++;
        lastError = "Exceeded maximum retry threshold";
        if (quarantined) {
          continue;
        }
        item.next_retry_at = Date.now() + 60000;
        await saveOutboxItem(item);
        break;
      }

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
        subcategory: normalizeOutboxSubcategory(item.parent_bucket, item.subcategory),
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
        const signal = AbortSignal.timeout(30000);
        const response = await fetch("/api/transactions", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal,
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
          signal.throwIfAborted();
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
              lastError = errorMsg;
            }
            await saveOutboxItem(item);
            failedCount++;
            continue;
          }

          // Permanently invalid payload; quarantine to DLQ to prevent blocking the queue and eliminate data loss
          const quarantined = await quarantineItem(item, errorMsg, 400);
          failedCount++;
          lastError = errorMsg;
          if (quarantined) {
            continue;
          }
          item.next_retry_at = Date.now() + 60000;
          await saveOutboxItem(item);
          break;
        }

        // Server error or unexpected status: apply exponential backoff (1s, 2s, 4s, capped at 60s)
        const serverRetryCount = (item.server_retry_count ?? 0) + 1;
        item.server_retry_count = serverRetryCount;
        item.retry_count = (item.retry_count ?? 0) + 1;
        if (serverRetryCount >= MAX_SYNC_RETRIES) {
          const quarantined = await quarantineItem(
            item,
            "Exceeded maximum retry threshold",
            response.status,
          );
          failedCount++;
          lastError = "Exceeded maximum retry threshold";
          if (quarantined) {
            continue;
          }
        }

        retryError = `Server returned HTTP ${response.status}. Saved transactions will retry.`;
        const backoffMs = Math.min(60000, 1000 * 2 ** (serverRetryCount - 1));
        item.next_retry_at = Date.now() + backoffMs;
        await saveOutboxItem(item);
        failedCount++;
        scheduleDueRetry(backoffMs, options, item.next_retry_at);
        transportHalted = true;
        break;
      } catch (error: unknown) {
        // Network error / offline: apply exponential backoff (1s, 2s, 4s, capped at 60s)
        retryError = `Sync interrupted: ${error instanceof Error ? error.message : "request or local storage failure"}. Saved transactions will retry.`;
        // Transport failures do not consume the server-error retry budget.
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
        const hasDueOrUnscheduled = activePendingItems.some(
          (item) =>
            typeof item.next_retry_at !== "number" ||
            Number.isNaN(item.next_retry_at) ||
            item.next_retry_at <= Date.now(),
        );

        if (hasDueOrUnscheduled) {
          scheduleDueRetry(0, options, Date.now());
        } else if (activePendingItems.length > 0) {
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
          }
        } else {
          clearRetryTimer();
        }
      }
    }
    options.onStatusChange?.(false, remainingCount);
  }

  return {
    syncedCount,
    failedCount,
    unauthorized,
    lastError,
    ...(retryError ? { retryError } : {}),
  };
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
