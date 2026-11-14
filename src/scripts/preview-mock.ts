import { BUCKET_SUBCATEGORIES } from "../config/intake.ts";
import type { RecentTransaction } from "./intake-form.ts";

export const PREVIEW_TRANSACTIONS_KEY = "snaptally_preview_transactions";
export const PREVIEW_DEMO_TOKEN = "preview-demo-token";
const TOKEN_STORAGE_KEY = "snaptally_api_token";
const MERCHANTS_STORAGE_KEY = "snaptally_merchants";

const VALID_BUCKETS = new Set(Object.keys(BUCKET_SUBCATEGORIES));

/**
 * Return whether preview mock mode is enabled for the current build or runtime.
 */
export function isPreviewMockEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  if (env?.PUBLIC_PREVIEW_MOCK === "true") {
    return true;
  }
  return Boolean((globalThis as Record<string, unknown>).__SNAPTALLY_PREVIEW_MOCK__ === true);
}

/**
 * Build deterministic seed transactions anchored to the given reference date.
 */
export function createSeedTransactions(referenceDate: Date = new Date()): RecentTransaction[] {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const isoMonth = (offsetMonths: number, day: number): string => {
    const d = new Date(Date.UTC(year, month + offsetMonths, day));
    return d.toISOString().slice(0, 10);
  };
  const safeDay = (d: number) => Math.min(d, Math.max(1, referenceDate.getDate()));

  const currentDay = safeDay(referenceDate.getDate());
  const d1 = isoMonth(0, currentDay);
  const d2 = isoMonth(0, Math.max(1, currentDay - 1));
  const d3 = isoMonth(0, Math.max(1, currentDay - 2));
  const d4 = isoMonth(0, Math.max(1, currentDay - 3));
  const d5 = isoMonth(0, 1);
  const prev1 = isoMonth(-1, 22);
  const prev2 = isoMonth(-1, 14);
  const prev3 = isoMonth(-1, 5);

  return [
    {
      id: "demo-tx-1",
      date: d1,
      card: "Amex Gold",
      parent_bucket: "Fixed Costs",
      subcategory: "Groceries",
      merchant: "Trader Joe's",
      gross_amount: 64.8,
      reimbursement: 0,
      net_spend: 64.8,
      currency: "USD",
      created_at: `${d1}T18:20:00.000Z`,
    },
    {
      id: "demo-tx-2",
      date: d1,
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Coffee & Snacks",
      merchant: "Blue Bottle Coffee",
      gross_amount: 6.75,
      reimbursement: 0,
      net_spend: 6.75,
      currency: "USD",
      created_at: `${d1}T09:15:00.000Z`,
    },
    {
      id: "demo-tx-3",
      date: d2,
      card: "Amex Gold",
      parent_bucket: "Guilt-Free",
      subcategory: "Dining",
      merchant: "Noodle Bar",
      gross_amount: 88.0,
      reimbursement: 44.0,
      net_spend: 44.0,
      currency: "USD",
      created_at: `${d2}T20:05:00.000Z`,
    },
    {
      id: "demo-tx-4",
      date: d3,
      card: "Savor",
      parent_bucket: "Guilt-Free",
      subcategory: "Shopping",
      merchant: "Target",
      gross_amount: -24.5,
      reimbursement: 0,
      net_spend: -24.5,
      currency: "USD",
      created_at: `${d3}T14:40:00.000Z`,
    },
    {
      id: "demo-tx-5",
      date: d3,
      card: "Checking",
      parent_bucket: "Fixed Costs",
      subcategory: "Transit",
      merchant: "STM Metro",
      gross_amount: 36.5,
      reimbursement: 0,
      net_spend: 36.5,
      currency: "CAD",
      created_at: `${d3}T08:30:00.000Z`,
    },
    {
      id: "demo-tx-6",
      date: d4,
      card: "Checking",
      parent_bucket: "Income",
      subcategory: "Salary",
      merchant: "Acme Payroll",
      gross_amount: 3200.0,
      reimbursement: 0,
      net_spend: 3200.0,
      currency: "USD",
      created_at: `${d4}T12:00:00.000Z`,
    },
    {
      id: "demo-tx-7",
      date: d5,
      card: "Checking",
      parent_bucket: "Fixed Costs",
      subcategory: "Rent",
      merchant: "Oakwood Apartments",
      gross_amount: 1850.0,
      reimbursement: 0,
      net_spend: 1850.0,
      currency: "USD",
      created_at: `${d5}T10:00:00.000Z`,
    },
    {
      id: "demo-tx-8",
      date: d5,
      card: "Checking",
      parent_bucket: "Investments",
      subcategory: "Brokerage",
      merchant: "Vanguard",
      gross_amount: 500.0,
      reimbursement: 0,
      net_spend: 500.0,
      currency: "USD",
      created_at: `${d5}T10:05:00.000Z`,
    },
    {
      id: "demo-tx-9",
      date: prev1,
      card: "Savor",
      parent_bucket: "Guilt-Free",
      subcategory: "Entertainment",
      merchant: "Alamo Drafthouse",
      gross_amount: 32.0,
      reimbursement: 0,
      net_spend: 32.0,
      currency: "USD",
      created_at: `${prev1}T21:10:00.000Z`,
    },
    {
      id: "demo-tx-10",
      date: prev2,
      card: "Amex Gold",
      parent_bucket: "Fixed Costs",
      subcategory: "Groceries",
      merchant: "Whole Foods",
      gross_amount: 112.4,
      reimbursement: 0,
      net_spend: 112.4,
      currency: "USD",
      created_at: `${prev2}T17:45:00.000Z`,
    },
    {
      id: "demo-tx-11",
      date: prev3,
      card: "Checking",
      parent_bucket: "Savings",
      subcategory: "Emergency Fund",
      merchant: "Ally Savings",
      gross_amount: 400.0,
      reimbursement: 0,
      net_spend: 400.0,
      currency: "USD",
      created_at: `${prev3}T09:00:00.000Z`,
    },
  ];
}

let memoryTransactions: RecentTransaction[] | null = null;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function safeGetItem(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(storage: Storage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveItem(storage: Storage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage removal errors in restricted browser environments.
  }
}

/**
 * Load preview transactions from localStorage, seeding on first access.
 */
export function loadPreviewTransactions(referenceDate: Date = new Date()): RecentTransaction[] {
  const storage = getStorage();
  if (!storage) {
    memoryTransactions ??= createSeedTransactions(referenceDate);
    return memoryTransactions;
  }

  if (!safeGetItem(storage, TOKEN_STORAGE_KEY)) {
    safeSetItem(storage, TOKEN_STORAGE_KEY, PREVIEW_DEMO_TOKEN);
  }

  const raw = safeGetItem(storage, PREVIEW_TRANSACTIONS_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoryTransactions = parsed as RecentTransaction[];
        return memoryTransactions;
      }
    } catch {
      // Fall through to re-seed on corrupt preview JSON.
    }
  }

  if (memoryTransactions !== null) {
    return memoryTransactions;
  }

  const seeded = createSeedTransactions(referenceDate);
  memoryTransactions = seeded;
  safeSetItem(storage, PREVIEW_TRANSACTIONS_KEY, JSON.stringify(seeded));
  return seeded;
}

/**
 * Persist preview transactions to localStorage.
 */
export function savePreviewTransactions(transactions: RecentTransaction[]): void {
  memoryTransactions = transactions;
  safeSetItem(getStorage(), PREVIEW_TRANSACTIONS_KEY, JSON.stringify(transactions));
}

/**
 * Reset preview transactions and demo token back to the initial seeded state.
 */
export function resetPreviewData(referenceDate: Date = new Date()): RecentTransaction[] {
  const seeded = createSeedTransactions(referenceDate);
  memoryTransactions = seeded;
  const storage = getStorage();
  safeSetItem(storage, PREVIEW_TRANSACTIONS_KEY, JSON.stringify(seeded));
  safeSetItem(storage, TOKEN_STORAGE_KEY, PREVIEW_DEMO_TOKEN);
  safeRemoveItem(storage, MERCHANTS_STORAGE_KEY);
  return seeded;
}

function sortTransactionsDesc(list: RecentTransaction[]): RecentTransaction[] {
  return [...list].sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return b.created_at.localeCompare(a.created_at);
  });
}

function computeFrequentMerchants(transactions: RecentTransaction[], limit: number): string[] {
  const stats = new Map<string, { count: number; latest: string }>();
  for (const tx of transactions) {
    const prev = stats.get(tx.merchant);
    if (!prev) {
      stats.set(tx.merchant, { count: 1, latest: tx.created_at });
    } else {
      stats.set(tx.merchant, {
        count: prev.count + 1,
        latest: Math.max(tx.created_at, prev.latest),
      });
    }
  }

  return Array.from(stats.entries())
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return b[1].latest.localeCompare(a[1].latest);
    })
    .slice(0, limit)
    .map(([merchant]) => merchant);
}

/**
 * Handle a mock preview API request against browser-persisted demo data.
 */
export async function handlePreviewApiRequest(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();

  if (url.pathname === "/api/merchants" && method === "GET") {
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const merchants = computeFrequentMerchants(loadPreviewTransactions(), limit);
    return Response.json({ merchants });
  }

  if (url.pathname === "/api/transactions" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >;
    } catch {
      return Response.json({ error: "Malformed JSON payload" }, { status: 400 });
    }

    const date = typeof body.date === "string" ? body.date.trim() : "";
    const card = typeof body.card === "string" ? body.card.trim() : "";
    const parentBucket = typeof body.parent_bucket === "string" ? body.parent_bucket.trim() : "";
    const subcategory = typeof body.subcategory === "string" ? body.subcategory.trim() : "";
    const merchant = typeof body.merchant === "string" ? body.merchant.trim() : "";
    const grossAmount = typeof body.gross_amount === "number" ? body.gross_amount : Number.NaN;
    const reimbursement =
      typeof body.reimbursement === "number" && Number.isFinite(body.reimbursement)
        ? body.reimbursement
        : 0;
    const currency = typeof body.currency === "string" ? body.currency.trim() : "USD";

    const allowedSubs = BUCKET_SUBCATEGORIES[parentBucket as keyof typeof BUCKET_SUBCATEGORIES];
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !card ||
      !VALID_BUCKETS.has(parentBucket) ||
      !allowedSubs?.includes(subcategory) ||
      !merchant ||
      !Number.isFinite(grossAmount) ||
      grossAmount === 0
    ) {
      return Response.json({ error: "Invalid payload" }, { status: 400 });
    }

    const id =
      typeof body.id === "string" && body.id.trim().length > 0
        ? body.id.trim()
        : `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const transactions = loadPreviewTransactions();
    if (!transactions.some((tx) => tx.id === id)) {
      const created: RecentTransaction = {
        id,
        date,
        card,
        parent_bucket: parentBucket,
        subcategory,
        merchant,
        gross_amount: grossAmount,
        reimbursement,
        net_spend: Number((grossAmount - reimbursement).toFixed(2)),
        currency,
        created_at: new Date().toISOString(),
      };
      savePreviewTransactions(sortTransactionsDesc([created, ...transactions]));
    }

    return Response.json({ ok: true, id }, { status: 201 });
  }

  if (url.pathname === "/api/transactions" && method === "GET") {
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
    const rawOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
    const bucket = (url.searchParams.get("bucket") ?? "").trim();
    const rawMonth = (url.searchParams.get("month") ?? "").trim();
    const targetMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      ? rawMonth
      : new Date().toISOString().slice(0, 7);

    const all = sortTransactionsDesc(loadPreviewTransactions());
    const filtered = all.filter((tx) => {
      if (bucket && tx.parent_bucket !== bucket) return false;
      if (search) {
        const hay = `${tx.merchant} ${tx.card}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const page = filtered.slice(offset, offset + limit);
    const hasMore = offset + page.length < filtered.length;
    const nextOffset = hasMore ? offset + page.length : null;

    const monthRows = all.filter(
      (tx) =>
        tx.date.startsWith(targetMonth) &&
        tx.parent_bucket !== "Income" &&
        (tx.currency ?? "USD") === "USD",
    );
    const monthNetSpend = Number(monthRows.reduce((sum, tx) => sum + tx.net_spend, 0).toFixed(2));

    return Response.json({
      transactions: page,
      total_count: filtered.length,
      has_more: hasMore,
      next_offset: nextOffset,
      month_summary: {
        month: targetMonth,
        net_spend: monthNetSpend,
        total_count: monthRows.length,
      },
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

const FETCH_MOCK_INSTALLED = Symbol.for("snaptally.previewFetchInstalled");

/**
 * Install the browser fetch interceptor for preview mock mode (idempotent).
 */
export function installPreviewFetchMock(): void {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  const win = window as unknown as Record<symbol, boolean> & Window;
  if (win[FETCH_MOCK_INSTALLED]) {
    return;
  }

  loadPreviewTransactions();

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(rawUrl, window.location.origin);
    if (
      parsed.origin === window.location.origin &&
      (parsed.pathname === "/api/transactions" || parsed.pathname === "/api/merchants")
    ) {
      const mergedInit: RequestInit | undefined =
        input instanceof Request && !init
          ? { method: input.method, body: await input.clone().text() }
          : init;
      return handlePreviewApiRequest(parsed, mergedInit);
    }
    return nativeFetch(input, init);
  };

  win[FETCH_MOCK_INSTALLED] = true;
}
