import { BUCKET_SUBCATEGORIES, DEFAULT_FREQUENT_MERCHANTS } from "../config/intake.ts";

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

export { BUCKET_SUBCATEGORIES, DEFAULT_FREQUENT_MERCHANTS };
export const CATEGORIES_BY_BUCKET = BUCKET_SUBCATEGORIES;
export const TOKEN_STORAGE_KEY = "snaptally_api_token";
export const CARDS_STORAGE_KEY = "snaptally_cards";

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

    // Card selection (dynamically populated from recent transactions with Other... fallback)
    cards: [] as string[],
    card: "",
    isCustomCard: false,
    customCardInput: "",
    autoCustomCard: false,

    // Bucket and subcategory selection
    buckets: Object.keys(BUCKET_SUBCATEGORIES),
    parentBucket: "Guilt-Free",
    subcategory: BUCKET_SUBCATEGORIES["Guilt-Free"][0],

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
      if (this.loading) {
        return;
      }
      if (this.amountCents === 0 && digit === 0) {
        return;
      }
      const nextAmount = this.amountCents * 10 + digit;
      if (nextAmount > this.maxCents) {
        this.statusMessage = "Maximum amount reached";
        this.isError = true;
        return;
      }
      this.amountCents = nextAmount;
    },

    pressBackspace(): void {
      if (this.loading) {
        return;
      }
      if (this.statusMessage === "Maximum amount reached") {
        this.statusMessage = "";
        this.isError = false;
      }
      this.amountCents = Math.floor(this.amountCents / 10);
    },

    pressClear(): void {
      if (this.loading) {
        return;
      }
      if (this.statusMessage === "Maximum amount reached") {
        this.statusMessage = "";
        this.isError = false;
      }
      this.amountCents = 0;
    },

    // Selectors
    selectCard(card: string): void {
      this.card = card;
      this.isCustomCard = false;
      this.autoCustomCard = false;
    },

    toggleCustomCard(): void {
      this.isCustomCard = !this.isCustomCard;
      this.autoCustomCard = false;
      if (this.isCustomCard) {
        if (this.customCardInput.trim().length > 0) {
          this.card = this.customCardInput.trim();
        }
      } else {
        this.card = this.cards[0] || "";
      }
    },

    updateCustomCard(value: string): void {
      this.customCardInput = value;
      this.card = value;
    },

    persistCards(): void {
      try {
        if (typeof localStorage !== "undefined" && this.cards.length > 0) {
          localStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(this.cards));
        }
      } catch {
        // Storage restricted or unavailable
      }
    },

    selectBucket(bucket: string): void {
      this.parentBucket = bucket;
      const subcategories = BUCKET_SUBCATEGORIES[bucket];
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
      try {
        if (typeof localStorage !== "undefined") {
          if (trimmed.length > 0) {
            localStorage.setItem(TOKEN_STORAGE_KEY, trimmed);
          } else {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
          }
        }
      } catch {
        // Storage restricted or unavailable
      }
      this.isSettingsOpen = false;
      if (this.hasToken) {
        this.loadFrequentMerchants();
        this.loadRecentTransactions();
      } else {
        this.frequentMerchants = [...DEFAULT_FREQUENT_MERCHANTS];
        this.recentTransactions = [];
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
      const requestToken = this.token;
      try {
        const response = await fetch("/api/merchants?limit=8", {
          headers: { Authorization: `Bearer ${requestToken}` },
        });
        if (!response.ok || this.token !== requestToken) {
          return;
        }
        const data = (await response.json()) as { merchants?: string[] };
        if (this.token !== requestToken) {
          return;
        }
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
      const requestToken = this.token;
      try {
        const response = await fetch("/api/transactions?limit=5", {
          headers: { Authorization: `Bearer ${requestToken}` },
        });
        if (!response.ok || this.token !== requestToken) {
          return;
        }
        const data = (await response.json()) as { transactions?: RecentTransaction[] };
        if (this.token !== requestToken) {
          return;
        }
        if (data.transactions) {
          this.recentTransactions = [...data.transactions].sort((a, b) => {
            const dateDiff = b.date.localeCompare(a.date);
            if (dateDiff !== 0) return dateDiff;
            return (b.created_at || "").localeCompare(a.created_at || "");
          });

          // Dynamically extract distinct cards from recent transactions
          const extractedCards: string[] = [];
          for (const tx of data.transactions) {
            const cardName = tx.card?.trim();
            if (cardName && !extractedCards.includes(cardName)) {
              extractedCards.push(cardName);
            }
          }
          if (extractedCards.length > 0) {
            const merged = [...this.cards];
            for (const c of extractedCards) {
              if (!merged.includes(c)) {
                merged.push(c);
              }
            }
            this.cards = merged;
            if (this.autoCustomCard) {
              this.isCustomCard = false;
              this.autoCustomCard = false;
            }
            if (!this.isCustomCard && (!this.card || !this.cards.includes(this.card))) {
              this.card = this.cards[0];
            }
            this.persistCards();
          }
        }
      } catch {
        // Silently preserve existing recent records on network or parse failures
      }
    },

    // Initialization lifecycle
    init(): void {
      this.resetDateToToday();
      try {
        if (typeof localStorage !== "undefined") {
          const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
          if (storedToken) {
            this.token = storedToken;
          }
          const storedCards = localStorage.getItem(CARDS_STORAGE_KEY);
          if (storedCards) {
            const parsed = JSON.parse(storedCards) as unknown;
            if (
              Array.isArray(parsed) &&
              parsed.every((item): item is string => typeof item === "string")
            ) {
              this.cards = parsed;
              if (parsed.length > 0) {
                this.card = parsed[0];
              }
            }
          }
        }
      } catch {
        // Storage restricted or unavailable
      }
      if (this.cards.length === 0) {
        this.isCustomCard = true;
        this.autoCustomCard = true;
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

      const trimmedCard = this.card.trim();
      if (!trimmedCard) {
        this.isError = true;
        this.statusMessage = "Please select or enter a card";
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

      const submittedAmountCents = this.amountCents;
      const payload = {
        date: this.date,
        card: trimmedCard,
        parent_bucket: this.parentBucket,
        subcategory: this.subcategory,
        merchant: trimmedMerchant,
        gross_amount: submittedAmountCents / 100,
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
          this.statusMessage = `Saved $${(submittedAmountCents / 100).toFixed(2)} at ${trimmedMerchant}`;
          this.amountCents = 0;
          this.resetDateToToday();
          if (this.isCustomMerchant) {
            this.isCustomMerchant = false;
            this.customMerchantInput = "";
            this.merchant = this.frequentMerchants[0] || "";
          }
          if (this.isCustomCard) {
            if (!this.cards.includes(trimmedCard)) {
              this.cards.unshift(trimmedCard);
              this.persistCards();
            }
            this.isCustomCard = false;
            this.autoCustomCard = false;
            this.customCardInput = "";
            this.card = trimmedCard;
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
