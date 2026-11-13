import {
  formatDateHeading,
  formatMonthName,
  formatTransactionTime,
  getTodayDate,
} from "../utils/date.ts";
import { TOKEN_STORAGE_KEY } from "./intake-form.ts";

export interface ActivityTransaction {
  id: string;
  date: string;
  card: string;
  parent_bucket: string;
  subcategory: string;
  merchant: string;
  gross_amount: number;
  reimbursement: number;
  net_spend: number;
  currency: string;
  created_at: string;
}

export interface ActivityMonthSummary {
  month: string;
  net_spend: number;
  total_count: number;
}

export interface DateGroup {
  date: string;
  dateLabel: string;
  transactions: ActivityTransaction[];
}

interface TransactionsApiResponse {
  transactions?: ActivityTransaction[];
  total_count?: number;
  has_more?: boolean;
  next_offset?: number | null;
  month_summary?: ActivityMonthSummary;
}

const DEFAULT_PAGE_LIMIT = 20;
export const ACTIVITY_CACHE_KEY = "snaptally_activity_cache";

async function cacheOwner(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.trim()));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface ActivityCache {
  version: 1;
  owner: string;
  query: string;
  transactions: ActivityTransaction[];
  totalCount: number;
  monthSummary: ActivityMonthSummary | null;
}

function validCache(value: ActivityCache): boolean {
  return (
    value?.version === 1 &&
    Array.isArray(value.transactions) &&
    value.transactions.length <= DEFAULT_PAGE_LIMIT &&
    value.transactions.every(
      (tx) =>
        tx &&
        [
          tx.id,
          tx.date,
          tx.card,
          tx.parent_bucket,
          tx.subcategory,
          tx.merchant,
          tx.currency,
          tx.created_at,
        ].every((field) => typeof field === "string") &&
        [tx.gross_amount, tx.reimbursement, tx.net_spend].every(Number.isFinite),
    ) &&
    Number.isSafeInteger(value.totalCount) &&
    value.totalCount >= 0 &&
    (value.monthSummary === null ||
      (typeof value.monthSummary?.month === "string" &&
        Number.isFinite(value.monthSummary.net_spend) &&
        Number.isSafeInteger(value.monthSummary.total_count)))
  );
}

/**
 * Creates state and actions for the fullscreen activity log view.
 */
export function activityView() {
  return {
    token: "",
    transactions: [] as ActivityTransaction[],
    totalCount: 0,
    hasMore: false,
    offset: 0,
    limit: DEFAULT_PAGE_LIMIT,
    loading: false,
    loadingMore: false,
    error: null as string | null,
    showingCached: false,
    searchQuery: "",
    selectedBucket: "",
    monthSummary: null as ActivityMonthSummary | null,
    searchDebounceTimer: null as ReturnType<typeof setTimeout> | null,
    requestSequence: 0,

    get hasToken(): boolean {
      return Boolean(this.token && this.token.trim().length > 0);
    },

    get monthSpendFormatted(): string {
      return Number(this.monthSummary?.net_spend ?? 0).toFixed(2);
    },

    get monthCount(): number {
      return Number(this.monthSummary?.total_count ?? 0);
    },

    get monthLabel(): string {
      return formatMonthName(this.monthSummary?.month);
    },

    get groupedTransactions(): DateGroup[] {
      const groups = new Map<string, ActivityTransaction[]>();
      for (const tx of this.transactions) {
        const key = tx.date || "Unknown";
        const list = groups.get(key);
        if (list) {
          list.push(tx);
        } else {
          groups.set(key, [tx]);
        }
      }

      const result: DateGroup[] = [];
      for (const [date, items] of groups.entries()) {
        result.push({
          date,
          dateLabel: formatDateHeading(date),
          transactions: items,
        });
      }
      return result;
    },

    init(): void {
      this.loadToken();
      this.loadInitial();
    },

    loadToken(): void {
      try {
        if (typeof localStorage !== "undefined") {
          this.token = localStorage.getItem(TOKEN_STORAGE_KEY) || "";
        }
      } catch {
        this.token = "";
      }
    },

    loadInitial(): void {
      this.fetchTransactions(true);
    },

    loadMore(): void {
      if (this.loading || this.loadingMore || !this.hasMore) {
        return;
      }
      this.fetchTransactions(false);
    },

    refresh(): void {
      this.loadInitial();
    },

    setBucket(bucket: string): void {
      if (this.selectedBucket === bucket) {
        return;
      }
      this.selectedBucket = bucket;
      this.loadInitial();
    },

    handleSearch(value: string): void {
      this.searchQuery = value;
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.searchDebounceTimer = setTimeout(() => {
        this.loadInitial();
      }, 250);
    },

    clearSearch(): void {
      this.searchQuery = "";
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.loadInitial();
    },

    formatTime(createdAt?: string): string {
      return formatTransactionTime(createdAt);
    },

    async fetchTransactions(reset: boolean): Promise<void> {
      const requestId = ++this.requestSequence;
      if (reset) {
        this.offset = 0;
        this.loading = true;
        this.error = null;
      } else {
        this.loadingMore = true;
      }

      const params = new URLSearchParams();
      params.set("limit", String(this.limit));
      params.set("offset", String(this.offset));
      params.set("month", getTodayDate().slice(0, 7));

      const trimmedSearch = this.searchQuery.trim();
      if (trimmedSearch.length > 0) {
        params.set("search", trimmedSearch);
      }

      const trimmedBucket = this.selectedBucket.trim();
      if (trimmedBucket.length > 0) {
        params.set("bucket", trimmedBucket);
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.token) {
        headers.Authorization = `Bearer ${this.token.trim()}`;
      }

      const requestToken = this.token.trim();
      const cacheQuery = new URLSearchParams(params);
      cacheQuery.set("offset", "0");
      let responseReceived = false;
      try {
        const response = await fetch(`/api/transactions?${params.toString()}`, {
          method: "GET",
          headers,
        });

        responseReceived = true;
        if (requestId !== this.requestSequence || this.token.trim() !== requestToken) {
          return;
        }
        this.showingCached = false;

        if (!response.ok) {
          if (response.status === 401) {
            this.error =
              "Unauthorized. Please configure your API token in Settings on the home page.";
          } else {
            this.error = `Failed to load activity (${response.status})`;
          }
          if (response.status === 401 || response.status === 403) {
            try {
              localStorage.removeItem(ACTIVITY_CACHE_KEY);
            } catch {
              /* Storage unavailable. */
            }
          }
          if (reset) {
            this.monthSummary = null;
            this.transactions = [];
            this.totalCount = 0;
            this.hasMore = false;
          }
          return;
        }

        const data = (await response.json()) as TransactionsApiResponse;
        if (requestId !== this.requestSequence || this.token.trim() !== requestToken) {
          return;
        }

        const incoming = data.transactions ?? [];

        if (reset) {
          this.transactions = incoming;
        } else {
          const loadedIds = new Set(this.transactions.map((tx) => tx.id));
          const newRows = incoming.filter((tx) => !loadedIds.has(tx.id));
          this.transactions = [...this.transactions, ...newRows];
        }

        this.totalCount = data.total_count ?? this.transactions.length;
        this.hasMore = Boolean(data.has_more);
        if (data.next_offset !== undefined && data.next_offset !== null) {
          this.offset = data.next_offset;
        } else {
          this.offset = this.transactions.length;
        }

        this.monthSummary = data.month_summary ?? null;
        this.error = null;
        if (reset && requestToken) {
          try {
            const owner = await cacheOwner(requestToken);
            if (requestId === this.requestSequence && this.token.trim() === requestToken) {
              const cached: ActivityCache = {
                version: 1,
                owner,
                query: cacheQuery.toString(),
                transactions: incoming.slice(0, DEFAULT_PAGE_LIMIT),
                totalCount: this.totalCount,
                monthSummary: this.monthSummary,
              };
              localStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify(cached));
            }
          } catch {
            /* Caching must not affect successful requests. */
          }
        }
      } catch (err) {
        if (requestId !== this.requestSequence) {
          return;
        }
        if (!responseReceived && reset && requestToken) {
          try {
            const owner = await cacheOwner(requestToken);
            const cached = JSON.parse(
              localStorage.getItem(ACTIVITY_CACHE_KEY) || "null",
            ) as ActivityCache;
            if (requestId !== this.requestSequence || this.token.trim() !== requestToken) return;
            if (
              validCache(cached) &&
              cached.owner === owner &&
              cached.query === cacheQuery.toString()
            ) {
              this.transactions = cached.transactions;
              this.totalCount = cached.totalCount;
              this.monthSummary = cached.monthSummary;
              this.offset = cached.transactions.length;
              this.hasMore = false;
              this.showingCached = true;
              this.error = null;
              return;
            }
          } catch {
            /* Missing, corrupt, or inaccessible cache. */
          }
        }
        this.showingCached = false;
        this.error = err instanceof Error ? err.message : "Network error loading transactions";
        if (reset) {
          this.monthSummary = null;
          this.transactions = [];
          this.totalCount = 0;
          this.hasMore = false;
        }
      } finally {
        if (requestId === this.requestSequence) {
          this.loading = false;
          this.loadingMore = false;
        }
      }
    },
  };
}
