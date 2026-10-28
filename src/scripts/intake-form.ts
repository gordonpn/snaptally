import { BUCKET_SUBCATEGORIES, DEFAULT_FREQUENT_MERCHANTS } from "../config/intake.ts";
import {
  type DeadLetterItem,
  deleteDeadLetterItem,
  getDeadLetterQueue,
  getOutbox,
  getOutboxCount,
  getRetryCount,
  type OutboxItem,
  requeueDeadLetterItem,
  type SyncResult,
  saveOutboxItem,
  setupSyncListeners,
  syncOutbox,
} from "./outbox.ts";

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
export const MERCHANTS_STORAGE_KEY = "snaptally_merchants";

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

/** Creates state and actions for local transaction entry and queue recovery. */
export function intakeForm() {
  return {
    // Keypad and amount state
    amountCents: 0,
    maxCents: 10000000,

    // Credit / Reimbursement sign state
    isNegative: false,

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

    // Merchant selection and autocomplete cache
    frequentMerchants: [...DEFAULT_FREQUENT_MERCHANTS],
    allMerchants: [...DEFAULT_FREQUENT_MERCHANTS],
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

    // Outbox & background sync state
    outboxCount: 0,
    isSyncing: false,
    isOutboxOpen: false,
    activeOutboxTab: "pending" as "pending" | "failed",
    outboxItems: [] as OutboxItem[],
    deadLetterItems: [] as DeadLetterItem[],
    deadLetterCount: 0,
    isQueueActionPending: false,
    authenticationFailed: false,
    syncError: "",
    queueError: "",
    syncTask: undefined as Promise<SyncResult> | undefined,
    retryCount: getRetryCount,

    // Form status
    loading: false,
    statusMessage: "",
    isError: false,

    // Getters
    get formattedAmount(): string {
      return `$${(this.amountCents / 100).toFixed(2)}`;
    },

    get persistentSyncMessage(): string {
      if (this.authenticationFailed) {
        return "Authentication failed. Check your API Bearer Token in Settings.";
      }
      if (this.deadLetterCount > 0) {
        return `${this.deadLetterCount} failed transaction${this.deadLetterCount === 1 ? " needs" : "s need"} attention in Sync Status.`;
      }
      return "";
    },

    get grossAmount(): number {
      const gross = this.amountCents / 100;
      return this.isNegative ? -gross : gross;
    },

    get netAmountCents(): number {
      return this.isNegative ? -this.amountCents : this.amountCents;
    },

    get amountFontSizeClass(): string {
      const displayLength = (this.isNegative ? 1 : 0) + this.formattedAmount.length;
      if (displayLength >= 10) {
        return "text-2xl sm:text-3xl";
      }
      if (displayLength >= 8) {
        return "text-3xl sm:text-4xl";
      }
      return "text-4xl sm:text-5xl";
    },

    get submitButtonLabel(): string {
      if (this.isNegative) {
        return "Save Credit";
      }
      return "Save Transaction";
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

    toggleNegative(): void {
      if (this.loading || this.parentBucket === "Income") {
        return;
      }
      this.isNegative = !this.isNegative;
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
      if (bucket === "Income") {
        this.isNegative = false;
      }
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

    persistMerchants(): void {
      try {
        if (typeof localStorage !== "undefined" && this.allMerchants.length > 0) {
          localStorage.setItem(MERCHANTS_STORAGE_KEY, JSON.stringify(this.allMerchants));
        }
      } catch {
        // Storage restricted or unavailable
      }
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
        this.syncPendingOutbox();
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
        if (this.token === requestToken && response.status === 401)
          this.authenticationFailed = true;
        if (!response.ok || this.token !== requestToken) {
          return;
        }
        this.authenticationFailed = false;
        const data = (await response.json()) as { merchants?: string[] };
        if (this.token !== requestToken) {
          return;
        }
        if (data.merchants && data.merchants.length > 0) {
          this.frequentMerchants = data.merchants.slice(0, 8);

          // Merge distinct merchants into autocomplete cache
          const merged = [...this.allMerchants];
          for (const m of data.merchants) {
            if (!merged.includes(m)) {
              merged.push(m);
            }
          }
          this.allMerchants = merged;
          this.persistMerchants();

          if (
            !this.isCustomMerchant &&
            (!this.merchant || !this.frequentMerchants.includes(this.merchant))
          ) {
            this.merchant = this.frequentMerchants[0];
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
        if (this.token === requestToken && response.status === 401)
          this.authenticationFailed = true;
        if (!response.ok || this.token !== requestToken) {
          return;
        }
        this.authenticationFailed = false;
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

    async recheckSyncStatus(): Promise<void> {
      const [pending, failed] = await Promise.all([getOutbox(), getDeadLetterQueue()]);
      this.outboxCount = pending.length;
      this.deadLetterCount = failed.length;
      if (this.isOutboxOpen) {
        this.outboxItems = pending;
        this.deadLetterItems = failed;
      }
    },

    async openOutboxDrawer(tab: "pending" | "failed" = "pending"): Promise<void> {
      this.activeOutboxTab = tab;
      this.isOutboxOpen = true;
      await this.recheckSyncStatus();
    },

    closeOutboxDrawer(): void {
      this.isOutboxOpen = false;
      this.outboxItems = [];
      this.deadLetterItems = [];
    },

    async retryDLQItem(id: string): Promise<void> {
      if (this.isQueueActionPending || this.isSyncing) return;
      this.isQueueActionPending = true;
      this.queueError = "";
      try {
        await requeueDeadLetterItem(id);
        await this.syncPendingOutbox();
      } catch (error: unknown) {
        this.queueError =
          error instanceof Error ? error.message : "Unable to retry this transaction.";
      } finally {
        await this.recheckSyncStatus();
        this.isQueueActionPending = false;
      }
    },

    async discardDLQItem(id: string): Promise<void> {
      if (this.isQueueActionPending || this.isSyncing) return;
      if (!confirm("Permanently discard this failed transaction? This cannot be undone.")) return;
      this.isQueueActionPending = true;
      this.queueError = "";
      try {
        await deleteDeadLetterItem(id);
      } catch (error: unknown) {
        this.queueError =
          error instanceof Error ? error.message : "Unable to discard this transaction.";
      } finally {
        await this.recheckSyncStatus();
        this.isQueueActionPending = false;
      }
    },

    // Background sync
    async syncPendingOutbox(force = false): Promise<SyncResult> {
      const previous = this.syncTask;
      const task = (async () => {
        if (previous) await previous;
        return this.performOutboxSync(force);
      })();
      this.syncTask = task;
      try {
        return await task;
      } finally {
        if (this.syncTask === task) this.syncTask = undefined;
      }
    },

    async performOutboxSync(force: boolean): Promise<SyncResult> {
      const requestToken = this.token;
      this.isSyncing = true;
      try {
        const result = await syncOutbox({
          token: this.token,
          force,
          onItemSynced: (item) => {
            // Prepend newly synced record to local recent feed
            const newTx: RecentTransaction = {
              id: item.id,
              date: item.date,
              card: item.card,
              parent_bucket: item.parent_bucket,
              subcategory: item.subcategory,
              merchant: item.merchant,
              gross_amount: item.gross_amount,
              reimbursement: item.reimbursement,
              net_spend: item.gross_amount - item.reimbursement,
              created_at: item.created_at,
            };
            this.recentTransactions = [
              newTx,
              ...this.recentTransactions.filter((t) => t.id !== item.id),
            ].slice(0, 5);
          },
          onStatusChange: (_syncing, count) => {
            this.outboxCount = count;
          },
        });

        this.syncError = result.retryError ?? result.lastError ?? "";
        if (this.token === requestToken) {
          if (result.unauthorized) this.authenticationFailed = true;
          else if (result.syncedCount > 0) this.authenticationFailed = false;
        }

        return result;
      } finally {
        await this.recheckSyncStatus();
        this.isSyncing = false;
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
          const storedMerchants = localStorage.getItem(MERCHANTS_STORAGE_KEY);
          if (storedMerchants) {
            const parsed = JSON.parse(storedMerchants) as unknown;
            if (
              Array.isArray(parsed) &&
              parsed.every((item): item is string => typeof item === "string")
            ) {
              const merged = [...parsed];
              for (const def of DEFAULT_FREQUENT_MERCHANTS) {
                if (!merged.includes(def)) {
                  merged.push(def);
                }
              }
              this.allMerchants = merged;
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

      void this.recheckSyncStatus();

      setupSyncListeners((force) => {
        this.syncPendingOutbox(force);
      });

      if (this.hasToken) {
        this.loadFrequentMerchants();
        this.loadRecentTransactions();
        this.syncPendingOutbox();
      }
    },

    // Transaction submission with 0ms optimistic outbox write
    async submitTransaction(): Promise<boolean> {
      if (this.loading) {
        return false;
      }

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
      try {
        const isCredit = this.isNegative;
        const submittedAmountCents = this.amountCents;
        const submittedGrossAmount = isCredit
          ? -(submittedAmountCents / 100)
          : submittedAmountCents / 100;
        const submittedReimbursement = 0.0;
        const formattedGross = (submittedAmountCents / 100).toFixed(2);

        const outboxItem: OutboxItem = {
          id:
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: this.date,
          card: trimmedCard,
          parent_bucket: this.parentBucket,
          subcategory: this.subcategory,
          merchant: trimmedMerchant,
          gross_amount: submittedGrossAmount,
          reimbursement: submittedReimbursement,
          created_at: new Date().toISOString(),
        };

        // 1. Optimistic write to IndexedDB outbox
        await saveOutboxItem(outboxItem);
        this.outboxCount = await getOutboxCount();

        // 2. 0ms UI reset
        if (isCredit) {
          this.statusMessage = `Saved credit of $${formattedGross} at ${trimmedMerchant}`;
        } else {
          this.statusMessage = `Saved $${formattedGross} at ${trimmedMerchant}`;
        }
        this.isError = false;
        this.amountCents = 0;
        this.isNegative = false;
        this.resetDateToToday();

        // Add merchant to local autocomplete cache
        if (!this.allMerchants.includes(trimmedMerchant)) {
          this.allMerchants.push(trimmedMerchant);
          this.persistMerchants();
        }

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

        // 3. Trigger background sync
        const syncResult = await this.syncPendingOutbox();
        if (syncResult.lastError) {
          return false;
        }

        return true;
      } finally {
        this.loading = false;
      }
    },
  };
}
