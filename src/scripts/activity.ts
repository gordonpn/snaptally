import { formatDateHeading, formatMonthName } from "../utils/date.ts";
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
    searchQuery: "",
    selectedBucket: "",
    monthSummary: null as ActivityMonthSummary | null,
    searchDebounceTimer: null as ReturnType<typeof setTimeout> | null,

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

    async fetchTransactions(reset: boolean): Promise<void> {
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

      try {
        const response = await fetch(`/api/transactions?${params.toString()}`, {
          method: "GET",
          headers,
        });

        if (!response.ok) {
          if (response.status === 401) {
            this.error =
              "Unauthorized. Please configure your API token in Settings on the home page.";
          } else {
            this.error = `Failed to load activity (${response.status})`;
          }
          if (reset) {
            this.transactions = [];
            this.totalCount = 0;
            this.hasMore = false;
          }
          return;
        }

        const data = (await response.json()) as TransactionsApiResponse;
        const incoming = data.transactions ?? [];

        if (reset) {
          this.transactions = incoming;
        } else {
          this.transactions = [...this.transactions, ...incoming];
        }

        this.totalCount = data.total_count ?? this.transactions.length;
        this.hasMore = Boolean(data.has_more);
        if (data.next_offset !== undefined && data.next_offset !== null) {
          this.offset = data.next_offset;
        } else {
          this.offset = this.transactions.length;
        }

        if (data.month_summary) {
          this.monthSummary = data.month_summary;
        }
        this.error = null;
      } catch (err) {
        this.error = err instanceof Error ? err.message : "Network error loading transactions";
        if (reset) {
          this.transactions = [];
          this.totalCount = 0;
          this.hasMore = false;
        }
      } finally {
        this.loading = false;
        this.loadingMore = false;
      }
    },
  };
}
