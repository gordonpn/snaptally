export interface RecentTransaction {
  id: string;
  date: string;
  card: string;
  parent_bucket: string;
  subcategory: string;
  merchant: string;
  gross_amount: number;
  reimbursement: number;
  net_spend: number;
  created_at: string;
}

export const CATEGORIES_BY_BUCKET: Record<string, string[]> = {
  "Guilt-Free": ["Dining", "Coffee", "Bars", "Shopping", "Entertainment"],
  "Fixed Costs": ["Rent", "Utilities", "Groceries", "Subscriptions", "Transit"],
  Savings: ["Emergency Fund", "Investments", "Travel Fund"],
};

export const DEFAULT_CARDS: string[] = ["Amex Gold", "Chase Sapphire", "Apple Cash"];

export const DEFAULT_FREQUENT_MERCHANTS: string[] = [
  "Trader Joe's",
  "Whole Foods",
  "George Howell",
  "Blue Bottle",
];

export const TOKEN_STORAGE_KEY = "snaptally_api_token";

/**
 * Returns today's date in local YYYY-MM-DD calendar format.
 */
export function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function intakeForm() {
  return {
    // Keypad and amount state
    amountCents: 0,
    maxCents: 10000000,

    // Card selection
    cards: [...DEFAULT_CARDS],
    card: DEFAULT_CARDS[0],

    // Bucket and subcategory selection
    buckets: Object.keys(CATEGORIES_BY_BUCKET),
    parentBucket: "Guilt-Free",
    subcategory: CATEGORIES_BY_BUCKET["Guilt-Free"][0],

    // Merchant selection
    frequentMerchants: [...DEFAULT_FREQUENT_MERCHANTS],
    merchant: DEFAULT_FREQUENT_MERCHANTS[0],
    isCustomMerchant: false,
    customMerchantInput: "",

    // Date state
    date: getTodayDate(),

    // Token and settings state
    token: "",
    isSettingsOpen: false,
    settingsTokenInput: "",

    // Recent transactions
    recentTransactions: [] as RecentTransaction[],
    isRecentOpen: false,

    // Form status
    loading: false,
    statusMessage: "",
    isError: false,

    // Getters
    get formattedAmount(): string {
      return `$${(this.amountCents / 100).toFixed(2)}`;
    },

    get grossAmount(): number {
      return this.amountCents / 100;
    },

    get subcategories(): string[] {
      return CATEGORIES_BY_BUCKET[this.parentBucket] ?? [];
    },

    get hasToken(): boolean {
      return Boolean(this.token && this.token.trim().length > 0);
    },

    get isToday(): boolean {
      return this.date === getTodayDate();
    },

    get isBackfill(): boolean {
      return this.date !== getTodayDate();
    },

    // Keypad actions
    pressDigit(digit: number): void {
      if (this.amountCents === 0 && digit === 0) {
        return;
      }
      if (this.amountCents >= this.maxCents) {
        this.statusMessage = "Maximum amount reached";
        this.isError = true;
        return;
      }
      this.amountCents = this.amountCents * 10 + digit;
    },

    pressBackspace(): void {
      this.amountCents = Math.floor(this.amountCents / 10);
    },

    pressClear(): void {
      this.amountCents = 0;
    },

    // Selectors
    selectCard(card: string): void {
      this.card = card;
    },

    selectBucket(bucket: string): void {
      this.parentBucket = bucket;
      const subcategories = CATEGORIES_BY_BUCKET[bucket];
      if (subcategories && subcategories.length > 0) {
        this.subcategory = subcategories[0];
      }
    },

    selectSubcategory(sub: string): void {
      this.subcategory = sub;
    },

    selectMerchant(merchant: string): void {
      this.merchant = merchant;
      this.isCustomMerchant = false;
    },

    toggleCustomMerchant(): void {
      this.isCustomMerchant = !this.isCustomMerchant;
      if (this.isCustomMerchant) {
        if (this.customMerchantInput.trim().length > 0) {
          this.merchant = this.customMerchantInput.trim();
        }
      } else {
        this.merchant = this.frequentMerchants[0] || "";
      }
    },

    updateCustomMerchant(value: string): void {
      this.customMerchantInput = value;
      this.merchant = value;
    },

    // Date actions
    setDate(newDate: string): void {
      if (!newDate) {
        return;
      }
      this.date = newDate;
    },

    resetDateToToday(): void {
      this.date = getTodayDate();
    },

    // Settings actions
    openSettings(): void {
      this.settingsTokenInput = this.token;
      this.isSettingsOpen = true;
    },

    closeSettings(): void {
      this.isSettingsOpen = false;
    },

    saveToken(): void {
      const trimmed = this.settingsTokenInput.trim();
      this.token = trimmed;
      if (typeof localStorage !== "undefined") {
        if (trimmed.length > 0) {
          localStorage.setItem(TOKEN_STORAGE_KEY, trimmed);
        } else {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
      }
      this.isSettingsOpen = false;
      if (this.hasToken) {
        this.loadFrequentMerchants();
        this.loadRecentTransactions();
      }
    },

    // Recent view toggle
    toggleRecent(): void {
      this.isRecentOpen = !this.isRecentOpen;
      if (this.isRecentOpen && this.hasToken) {
        this.loadRecentTransactions();
      }
    },

    // Remote data loaders
    async loadFrequentMerchants(): Promise<void> {
      if (!this.token) {
        return;
      }
      try {
        const response = await fetch("/api/merchants?limit=8", {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { merchants?: string[] };
        if (data.merchants && data.merchants.length > 0) {
          this.frequentMerchants = data.merchants;
          if (
            !this.isCustomMerchant &&
            (!this.merchant || !this.frequentMerchants.includes(this.merchant))
          ) {
            this.merchant = data.merchants[0];
          }
        }
      } catch {
        // Silently preserve default merchants on network or parse failures
      }
    },

    async loadRecentTransactions(): Promise<void> {
      if (!this.token) {
        return;
      }
      try {
        const response = await fetch("/api/transactions?limit=5", {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { transactions?: RecentTransaction[] };
        if (data.transactions) {
          this.recentTransactions = data.transactions;
        }
      } catch {
        // Silently preserve existing recent records on network or parse failures
      }
    },

    // Initialization lifecycle
    init(): void {
      this.resetDateToToday();
      if (typeof localStorage !== "undefined") {
        const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (storedToken) {
          this.token = storedToken;
        }
      }
      if (this.hasToken) {
        this.loadFrequentMerchants();
        this.loadRecentTransactions();
      }
    },

    // Transaction submission
    async submitTransaction(): Promise<boolean> {
      if (this.amountCents <= 0) {
        this.isError = true;
        this.statusMessage = "Please enter an amount";
        return false;
      }

      const trimmedMerchant = this.merchant.trim();
      if (!trimmedMerchant) {
        this.isError = true;
        this.statusMessage = "Please select or enter a merchant";
        return false;
      }

      this.loading = true;
      this.statusMessage = "Saving transaction...";
      this.isError = false;

      const payload = {
        date: this.date,
        card: this.card,
        parent_bucket: this.parentBucket,
        subcategory: this.subcategory,
        merchant: trimmedMerchant,
        gross_amount: this.amountCents / 100,
        reimbursement: 0.0,
      };

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      try {
        const response = await fetch("/api/transactions", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          id?: string;
          error?: string;
        } | null;

        if (response.status === 201 && data?.ok) {
          this.statusMessage = `Saved $${(this.amountCents / 100).toFixed(2)} at ${trimmedMerchant}`;
          this.amountCents = 0;
          this.resetDateToToday();
          if (this.isCustomMerchant) {
            this.isCustomMerchant = false;
            this.customMerchantInput = "";
          }
          if (this.hasToken) {
            this.loadRecentTransactions();
            this.loadFrequentMerchants();
          }
          return true;
        }

        this.isError = true;
        this.statusMessage = `Error: ${data?.error || response.statusText || "Failed to save"}`;
        return false;
      } catch {
        this.isError = true;
        this.statusMessage = "Network error: Unable to reach endpoint";
        return false;
      } finally {
        this.loading = false;
      }
    },
  };
}
