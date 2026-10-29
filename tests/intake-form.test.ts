import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  CARDS_STORAGE_KEY,
  DEFAULT_FREQUENT_MERCHANTS,
  getTodayDate,
  intakeForm,
  type RecentTransaction,
  TOKEN_STORAGE_KEY,
} from "../src/scripts/intake-form.ts";
import { clearDeadLetterQueue, clearOutbox, clearRetryTimer } from "../src/scripts/outbox.ts";

class MockLocalStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

afterEach(async () => {
  clearRetryTimer();
  await clearOutbox();
});

function recentMerchant(overrides: Partial<RecentTransaction> = {}): RecentTransaction {
  return {
    id: "1",
    date: "2026-01-01",
    card: "Amex Gold",
    parent_bucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    merchant: "Starbucks",
    gross_amount: 5,
    reimbursement: 0,
    net_spend: 5,
    created_at: "2026-01-01",
    ...overrides,
  };
}

describe("merchant defaults", () => {
  it("infers a known merchant category without overwriting manual choices", () => {
    const form = intakeForm();

    form.selectMerchant("Trader Joe's");
    assert.equal(form.parentBucket, "Fixed Costs");
    assert.equal(form.subcategory, "Groceries");

    form.selectBucket("Guilt-Free");
    form.selectSubcategory("Dining");
    form.selectCard("My Card");
    form.selectMerchant("Starbucks");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Dining");
    assert.equal(form.card, "My Card");
  });

  it("uses recent merchant history for card and uncategorized merchants", () => {
    const form = intakeForm();
    form.recentTransactions = [recentMerchant()];

    form.selectMerchant("Starbucks");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Coffee & Snacks");
    assert.equal(form.card, "Amex Gold");
  });

  it("uses the most common recent tuple for an unknown merchant", () => {
    const form = intakeForm();
    form.recentTransactions = [
      recentMerchant({ id: "2", merchant: "Local Shop", card: "Amex Gold", subcategory: "Dining" }),
      recentMerchant({ id: "1", merchant: "Local Shop", card: "Visa", subcategory: "Shopping" }),
      recentMerchant({ id: "3", merchant: "Local Shop", card: "Visa", subcategory: "Shopping" }),
    ];

    form.updateCustomMerchant(" local shop ");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Shopping");
    assert.equal(form.card, "Visa");
  });

  it("keeps an unknown merchant's current selections", () => {
    const form = intakeForm();
    form.card = "Existing card";
    form.parentBucket = "Fixed Costs";
    form.subcategory = "Groceries";

    form.selectMerchant("Unrecognized Vendor");

    assert.equal(form.parentBucket, "Fixed Costs");
    assert.equal(form.subcategory, "Groceries");
    assert.equal(form.card, "Existing card");
  });

  it("ignores an invalid historical bucket", () => {
    const form = intakeForm();
    form.recentTransactions = [
      recentMerchant({ merchant: "Local Shop", parent_bucket: "toString" }),
    ];

    form.selectMerchant("Local Shop");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Dining");
  });

  it("infers a typed canonical merchant without cached history", () => {
    const form = intakeForm();

    form.updateCustomMerchant("Starbucks");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Coffee & Snacks");
  });

  it("reapplies defaults when restoring custom merchant input", () => {
    const form = intakeForm();
    form.recentTransactions = [recentMerchant()];
    form.card = "Visa";
    form.toggleCustomMerchant();
    form.updateCustomMerchant("Starbucks");
    form.toggleCustomMerchant();

    form.toggleCustomMerchant();

    assert.equal(form.merchant, "Starbucks");
    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Coffee & Snacks");
    assert.equal(form.card, "Amex Gold");
  });

  it("preserves a manual category while still inferring a card", () => {
    const form = intakeForm();
    form.recentTransactions = [recentMerchant()];
    form.selectBucket("Fixed Costs");
    form.selectSubcategory("Groceries");

    form.selectMerchant("Starbucks");

    assert.equal(form.parentBucket, "Fixed Costs");
    assert.equal(form.subcategory, "Groceries");
    assert.equal(form.card, "Amex Gold");
  });

  it("restores previous selections when changing to an unknown merchant", () => {
    const form = intakeForm();
    form.card = "Existing card";
    form.recentTransactions = [recentMerchant()];

    form.selectMerchant("Starbucks");
    form.updateCustomMerchant("Unknown vendor");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Dining");
    assert.equal(form.card, "Existing card");
  });

  it("keeps credit mode on an expense category when the baseline is Income", () => {
    const form = intakeForm();
    form.parentBucket = "Income";
    form.subcategory = "Salary";

    form.selectMerchant("Starbucks");
    form.toggleNegative();
    form.selectMerchant("Unknown vendor");

    assert.equal(form.isNegative, true);
    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Dining");
  });

  it("recognizes typed merchant aliases", () => {
    const form = intakeForm();

    form.updateCustomMerchant("WHOLEFDS");

    assert.equal(form.parentBucket, "Fixed Costs");
    assert.equal(form.subcategory, "Groceries");
  });

  it("finds canonical merchant history for a typed alias", () => {
    const form = intakeForm();
    form.recentTransactions = [recentMerchant({ merchant: "Whole Foods Market", card: "Visa" })];

    form.updateCustomMerchant("WHOLEFDS");

    assert.equal(form.subcategory, "Groceries");
    assert.equal(form.card, "Visa");
  });

  it("recognizes canonical merchant names even when a shorter rule matches first", () => {
    const form = intakeForm();

    form.updateCustomMerchant("Amazon Marketplace");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Shopping");
  });

  it("recognizes a canonical merchant after descriptor cleanup", () => {
    const form = intakeForm();
    form.recentTransactions = [recentMerchant({ merchant: "Whole Foods Market", card: "Visa" })];

    form.updateCustomMerchant("Whole Foods Market Boston MA");

    assert.equal(form.parentBucket, "Fixed Costs");
    assert.equal(form.subcategory, "Groceries");
    assert.equal(form.card, "Visa");
  });

  it("does not apply an unrelated rule token inside a merchant name", () => {
    const form = intakeForm();
    form.allMerchants = ["Medium Rare"];

    form.updateCustomMerchant("Medium Rare");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Dining");
  });

  it("retains inferred values for a second transaction at the same merchant", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    form.recentTransactions = [recentMerchant()];
    form.selectMerchant("Starbucks");
    form.pressDigit(1);

    try {
      await form.submitTransaction();

      assert.equal(form.merchant, "Starbucks");
      assert.equal(form.subcategory, "Coffee & Snacks");
      assert.equal(form.card, "Amex Gold");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("restores the baseline when switching merchants after an inferred transaction", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    form.card = "Visa";
    form.recentTransactions = [recentMerchant()];
    form.selectMerchant("Starbucks");
    form.pressDigit(1);

    try {
      await form.submitTransaction();
      form.selectMerchant("Unknown vendor");

      assert.equal(form.subcategory, "Dining");
      assert.equal(form.card, "Visa");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("infers a typed contextual merchant", () => {
    const form = intakeForm();
    form.parentBucket = "Fixed Costs";
    form.subcategory = "Groceries";

    form.updateCustomMerchant("Local Pizzeria");

    assert.equal(form.parentBucket, "Guilt-Free");
    assert.equal(form.subcategory, "Dining");
  });

  it("uses history that arrives after an uncached merchant is typed", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    const response = Promise.withResolvers<Response>();
    globalThis.fetch = () => response.promise;
    form.token = "token";

    try {
      const loading = form.loadRecentTransactions();
      form.updateCustomMerchant("Local Shop");
      response.resolve(
        Response.json({
          transactions: [
            recentMerchant({ merchant: "Local Shop", card: "Visa", subcategory: "Shopping" }),
          ],
        }),
      );
      await loading;

      assert.equal(form.subcategory, "Shopping");
      assert.equal(form.card, "Visa");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores an older history response arriving after a newer response", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    const oldResponse = Promise.withResolvers<Response>();
    const newResponse = Promise.withResolvers<Response>();
    let calls = 0;
    globalThis.fetch = () => (++calls === 1 ? oldResponse.promise : newResponse.promise);
    form.token = "token";

    try {
      const oldLoading = form.loadRecentTransactions();
      const newLoading = form.loadRecentTransactions();
      form.selectMerchant("Starbucks");
      newResponse.resolve(Response.json({ transactions: [recentMerchant({ card: "Visa" })] }));
      await newLoading;
      oldResponse.resolve(Response.json({ transactions: [recentMerchant({ card: "Old card" })] }));
      await oldLoading;

      assert.equal(form.card, "Visa");
      assert.equal(form.recentTransactions[0].card, "Visa");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("restores automatic choices when matching history disappears", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ transactions: [] });
    form.token = "token";
    form.card = "Existing card";
    form.recentTransactions = [
      recentMerchant({ merchant: "Local Shop", card: "Visa", subcategory: "Shopping" }),
    ];
    form.selectMerchant("Local Shop");

    try {
      await form.loadRecentTransactions();

      assert.equal(form.subcategory, "Dining");
      assert.equal(form.card, "Existing card");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves a selected merchant when its list response arrives after save", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    const response = Promise.withResolvers<Response>();
    globalThis.fetch = (input) =>
      String(input).includes("/api/merchants")
        ? response.promise
        : Promise.resolve(Response.json({ ok: true }, { status: 201 }));
    form.token = "token";
    form.card = "Visa";

    try {
      const loading = form.loadFrequentMerchants();
      form.selectMerchant("Trader Joe's");
      form.pressDigit(1);
      await form.submitTransaction();
      response.resolve(Response.json({ merchants: ["Starbucks"] }));
      await loading;

      assert.equal(form.merchant, "Trader Joe's");
      assert.deepEqual(form.frequentMerchants, ["Trader Joe's", "Starbucks"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses history arriving after a merchant selection without overriding manual choices", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    const response = Promise.withResolvers<Response>();
    globalThis.fetch = () => response.promise;
    form.token = "token";

    try {
      const loading = form.loadRecentTransactions();
      form.selectMerchant("Starbucks");
      form.selectBucket("Fixed Costs");
      form.selectSubcategory("Groceries");
      response.resolve(Response.json({ transactions: [recentMerchant()] }));
      await loading;

      assert.equal(form.parentBucket, "Fixed Costs");
      assert.equal(form.subcategory, "Groceries");
      assert.equal(form.card, "Amex Gold");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves a manual card when history arrives later", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    const response = Promise.withResolvers<Response>();
    globalThis.fetch = () => response.promise;
    form.token = "token";

    try {
      const loading = form.loadRecentTransactions();
      form.selectMerchant("Starbucks");
      form.selectCard("Visa");
      response.resolve(Response.json({ transactions: [recentMerchant()] }));
      await loading;

      assert.equal(form.card, "Visa");
      assert.equal(form.subcategory, "Coffee & Snacks");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps a selected merchant visible when the merchant list arrives later", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    const response = Promise.withResolvers<Response>();
    globalThis.fetch = () => response.promise;
    form.token = "token";

    try {
      const loading = form.loadFrequentMerchants();
      form.selectMerchant("Trader Joe's");
      response.resolve(Response.json({ merchants: ["Starbucks"] }));
      await loading;

      assert.equal(form.merchant, "Trader Joe's");
      assert.deepEqual(form.frequentMerchants, ["Trader Joe's", "Starbucks"]);
      assert.equal(form.subcategory, "Groceries");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps one selected chip when the refreshed merchant has different casing", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    const response = Promise.withResolvers<Response>();
    globalThis.fetch = () => response.promise;
    form.token = "token";

    try {
      const loading = form.loadFrequentMerchants();
      form.selectMerchant("trader joe's");
      response.resolve(Response.json({ merchants: ["Trader Joe's", "Starbucks"] }));
      await loading;

      assert.equal(form.merchant, "trader joe's");
      assert.deepEqual(form.frequentMerchants, ["trader joe's", "Starbucks"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("allows new inference after saving a manual selection", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    form.selectBucket("Fixed Costs");
    form.selectSubcategory("Rent");
    form.selectCard("Visa");
    form.selectMerchant("Trader Joe's");
    form.pressDigit(1);

    try {
      await form.submitTransaction();
      form.selectMerchant("Starbucks");

      assert.equal(form.parentBucket, "Guilt-Free");
      assert.equal(form.subcategory, "Coffee & Snacks");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("restores the previous selection for an unmatched merchant after a save", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    form.selectMerchant("Trader Joe's");
    form.selectBucket("Guilt-Free");
    form.selectSubcategory("Dining");
    form.selectCard("Visa");
    form.pressDigit(1);

    try {
      await form.submitTransaction();
      form.selectMerchant("Starbucks");
      form.selectMerchant("Unknown vendor");

      assert.equal(form.parentBucket, "Guilt-Free");
      assert.equal(form.subcategory, "Dining");
      assert.equal(form.card, "Visa");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores missing merchant and card values in history", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({
        transactions: [
          { ...recentMerchant(), merchant: null },
          { ...recentMerchant({ id: "2" }), card: null },
        ],
      });
    form.token = "token";

    try {
      await form.loadRecentTransactions();
      form.card = "";
      form.selectMerchant("Starbucks");

      assert.equal(form.subcategory, "Coffee & Snacks");
      assert.equal(form.card, "");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores non-string cached merchants while typing", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ merchants: [42] });
    form.token = "token";

    try {
      await form.loadFrequentMerchants();
      form.updateCustomMerchant("Unknown vendor");

      assert.equal(form.merchant, "Unknown vendor");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getTodayDate helper", () => {
  it("returns current local calendar date in YYYY-MM-DD format", () => {
    const today = getTodayDate();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    const now = new Date();
    const expected = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    assert.strictEqual(today, expected);
  });
});

describe("intakeForm ATM Keypad & Amount Entry (Scenario 1)", () => {
  it("initializes with zero amount and $0.00 display", () => {
    const form = intakeForm();
    assert.strictEqual(form.amountCents, 0);
    assert.strictEqual(form.formattedAmount, "$0.00");
    assert.strictEqual(form.grossAmount, 0);
  });

  it("shifts typed digits into cents format (1, 2, 5, 0 -> $12.50)", () => {
    const form = intakeForm();
    form.pressDigit(1);
    assert.strictEqual(form.amountCents, 1);
    assert.strictEqual(form.formattedAmount, "$0.01");

    form.pressDigit(2);
    assert.strictEqual(form.amountCents, 12);
    assert.strictEqual(form.formattedAmount, "$0.12");

    form.pressDigit(5);
    assert.strictEqual(form.amountCents, 125);
    assert.strictEqual(form.formattedAmount, "$1.25");

    form.pressDigit(0);
    assert.strictEqual(form.amountCents, 1250);
    assert.strictEqual(form.formattedAmount, "$12.50");
    assert.strictEqual(form.grossAmount, 12.5);
  });

  it("ignores leading zeros when amount is zero", () => {
    const form = intakeForm();
    form.pressDigit(0);
    assert.strictEqual(form.amountCents, 0);
    assert.strictEqual(form.formattedAmount, "$0.00");

    form.pressDigit(0);
    assert.strictEqual(form.amountCents, 0);
    assert.strictEqual(form.formattedAmount, "$0.00");
  });

  it("caps amount at maximum ceiling to prevent numeric overflow", () => {
    const form = intakeForm();
    form.amountCents = 9999999;
    form.pressDigit(9);
    assert.strictEqual(form.amountCents, 9999999);
    assert.strictEqual(form.statusMessage, "Maximum amount reached");
    assert.strictEqual(form.isError, true);

    form.pressBackspace();
    assert.strictEqual(form.statusMessage, "");
    assert.strictEqual(form.isError, false);
    assert.strictEqual(form.amountCents, 999999);

    form.amountCents = 10000000;
    form.pressDigit(1);
    assert.strictEqual(form.amountCents, 10000000);
    assert.strictEqual(form.statusMessage, "Maximum amount reached");

    form.pressClear();
    assert.strictEqual(form.statusMessage, "");
    assert.strictEqual(form.isError, false);
    assert.strictEqual(form.amountCents, 0);
  });

  it("pops the lowest digit on backspace", () => {
    const form = intakeForm();
    form.pressDigit(4);
    form.pressDigit(5);
    form.pressDigit(0);
    assert.strictEqual(form.formattedAmount, "$4.50");

    form.pressBackspace();
    assert.strictEqual(form.amountCents, 45);
    assert.strictEqual(form.formattedAmount, "$0.45");

    form.pressBackspace();
    assert.strictEqual(form.amountCents, 4);
    assert.strictEqual(form.formattedAmount, "$0.04");

    form.pressBackspace();
    assert.strictEqual(form.amountCents, 0);
    assert.strictEqual(form.formattedAmount, "$0.00");

    form.pressBackspace();
    assert.strictEqual(form.amountCents, 0);
    assert.strictEqual(form.formattedAmount, "$0.00");
  });

  it("resets amount to zero on clear", () => {
    const form = intakeForm();
    form.pressDigit(9);
    form.pressDigit(9);
    form.pressDigit(9);
    assert.strictEqual(form.formattedAmount, "$9.99");

    form.pressClear();
    assert.strictEqual(form.amountCents, 0);
    assert.strictEqual(form.formattedAmount, "$0.00");
  });

  it("ignores keypad presses while loading is in progress", () => {
    const form = intakeForm();
    form.pressDigit(5);
    form.loading = true;

    form.pressDigit(0);
    assert.strictEqual(form.amountCents, 5);

    form.pressBackspace();
    assert.strictEqual(form.amountCents, 5);

    form.pressClear();
    assert.strictEqual(form.amountCents, 5);
  });
});

describe("intakeForm Dynamic Subcategory Switching (Scenario 2)", () => {
  it("initializes with Guilt-Free and Dining selected", () => {
    const form = intakeForm();
    assert.strictEqual(form.parentBucket, "Guilt-Free");
    assert.strictEqual(form.subcategory, "Dining");
    assert.deepStrictEqual(form.subcategories, [
      "Dining",
      "Takeout",
      "Coffee & Snacks",
      "Bars",
      "Shopping",
      "Entertainment",
    ]);
  });

  it("switches subcategories dynamically when parent bucket changes and auto-selects first subcategory", () => {
    const form = intakeForm();

    form.selectBucket("Fixed Costs");
    assert.strictEqual(form.parentBucket, "Fixed Costs");
    assert.strictEqual(form.subcategory, "Rent");
    assert.deepStrictEqual(form.subcategories, [
      "Rent",
      "Utilities",
      "Groceries",
      "Subscriptions",
      "Transit",
      "Healthcare",
      "Fitness",
    ]);

    form.selectBucket("Savings");
    assert.strictEqual(form.parentBucket, "Savings");
    assert.strictEqual(form.subcategory, "Emergency Fund");
    assert.deepStrictEqual(form.subcategories, ["Emergency Fund", "Investments", "Travel Fund"]);

    form.selectBucket("Income");
    assert.strictEqual(form.parentBucket, "Income");
    assert.strictEqual(form.subcategory, "Salary");
    assert.deepStrictEqual(form.subcategories, ["Salary", "Other"]);
  });

  it("keeps Income positive and turns off credit mode when Income is selected", () => {
    const form = intakeForm();

    form.selectBucket("Income");
    form.toggleNegative();
    assert.strictEqual(form.isNegative, false);

    form.selectBucket("Guilt-Free");
    form.toggleNegative();
    assert.strictEqual(form.isNegative, true);

    form.selectBucket("Income");
    assert.strictEqual(form.parentBucket, "Income");
    assert.strictEqual(form.isNegative, false);
  });

  it("allows selecting a specific subcategory within the active bucket", () => {
    const form = intakeForm();
    form.selectBucket("Guilt-Free");
    form.selectSubcategory("Takeout");
    assert.strictEqual(form.subcategory, "Takeout");

    form.selectSubcategory("Coffee & Snacks");
    assert.strictEqual(form.subcategory, "Coffee & Snacks");
  });
});

describe("intakeForm Card and Merchant Selection", () => {
  it("allows selecting a card from available cards and toggling custom card", () => {
    const form = intakeForm();
    form.cards = ["Amex Gold", "Chase Sapphire"];
    form.card = "Amex Gold";
    form.selectCard("Chase Sapphire");
    assert.strictEqual(form.card, "Chase Sapphire");
    assert.strictEqual(form.isCustomCard, false);

    form.toggleCustomCard();
    assert.strictEqual(form.isCustomCard, true);

    form.updateCustomCard("Apple Card");
    assert.strictEqual(form.customCardInput, "Apple Card");
    assert.strictEqual(form.card, "Apple Card");

    form.toggleCustomCard();
    assert.strictEqual(form.isCustomCard, false);
    assert.strictEqual(form.card, "Amex Gold");

    form.toggleCustomCard();
    assert.strictEqual(form.isCustomCard, true);
    assert.strictEqual(form.card, "Apple Card");
  });

  it("allows selecting a merchant from frequent merchant pills", () => {
    const form = intakeForm();
    assert.strictEqual(form.merchant, DEFAULT_FREQUENT_MERCHANTS[0]);
    form.selectMerchant("Dig");
    assert.strictEqual(form.merchant, "Dig");
    assert.strictEqual(form.isCustomMerchant, false);
  });

  it("allows toggling and updating custom merchant input", () => {
    const form = intakeForm();
    form.toggleCustomMerchant();
    assert.strictEqual(form.isCustomMerchant, true);

    form.updateCustomMerchant("Local Bakery");
    assert.strictEqual(form.customMerchantInput, "Local Bakery");
    assert.strictEqual(form.merchant, "Local Bakery");

    form.toggleCustomMerchant();
    assert.strictEqual(form.isCustomMerchant, false);
    assert.strictEqual(form.merchant, DEFAULT_FREQUENT_MERCHANTS[0]);

    form.toggleCustomMerchant();
    assert.strictEqual(form.isCustomMerchant, true);
    assert.strictEqual(form.merchant, "Local Bakery");
  });
});

describe("intakeForm Token Persistence (Scenario 3)", () => {
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  it("loads existing token on init if present in localStorage", () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "saved-token-123");
    const form = intakeForm();
    form.init();
    assert.strictEqual(form.token, "saved-token-123");
    assert.strictEqual(form.hasToken, true);
  });

  it("saves token to localStorage and updates state", () => {
    const form = intakeForm();
    form.openSettings();
    form.settingsTokenInput = "new-bearer-token";
    form.saveToken();

    assert.strictEqual(form.token, "new-bearer-token");
    assert.strictEqual(mockStorage.getItem(TOKEN_STORAGE_KEY), "new-bearer-token");
    assert.strictEqual(form.isSettingsOpen, false);
    assert.strictEqual(form.hasToken, true);
  });

  it("removes token from localStorage and resets merchants and transactions while preserving cards", () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "existing-token");
    mockStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(["Amex Gold"]));
    const form = intakeForm();
    form.token = "existing-token";
    form.cards = ["Amex Gold"];
    form.card = "Amex Gold";
    form.isCustomCard = false;
    form.frequentMerchants = ["Custom Store"];
    form.recentTransactions = [
      {
        id: "tx-test-1",
        date: "2026-09-30",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Custom Store",
        gross_amount: 10,
        reimbursement: 0,
        net_spend: 10,
        created_at: "2026-09-30 12:00:00",
      },
    ];

    form.openSettings();
    form.settingsTokenInput = "   ";
    form.saveToken();

    assert.strictEqual(form.token, "");
    assert.strictEqual(mockStorage.getItem(TOKEN_STORAGE_KEY), null);
    assert.strictEqual(mockStorage.getItem(CARDS_STORAGE_KEY), JSON.stringify(["Amex Gold"]));
    assert.strictEqual(form.hasToken, false);
    assert.deepStrictEqual(form.frequentMerchants, DEFAULT_FREQUENT_MERCHANTS);
    assert.deepStrictEqual(form.recentTransactions, []);
    assert.deepStrictEqual(form.cards, ["Amex Gold"]);
    assert.strictEqual(form.card, "Amex Gold");
    assert.strictEqual(form.isCustomCard, false);
  });

  it("cancels settings without saving when closeSettings is called", () => {
    const form = intakeForm();
    form.token = "initial-token";
    form.openSettings();
    form.settingsTokenInput = "changed-but-canceled";
    form.closeSettings();

    assert.strictEqual(form.isSettingsOpen, false);
    assert.strictEqual(form.token, "initial-token");
  });

  it("handles storage exceptions gracefully when localStorage is restricted", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem() {
          throw new Error("SecurityError: Access denied");
        },
        setItem() {
          throw new Error("QuotaExceededError");
        },
        removeItem() {
          throw new Error("SecurityError");
        },
      },
      writable: true,
      configurable: true,
    });

    const form = intakeForm();
    form.init();
    assert.strictEqual(form.token, "");

    form.openSettings();
    form.settingsTokenInput = "token-without-crash";
    form.saveToken();
    assert.strictEqual(form.token, "token-without-crash");
    assert.strictEqual(form.isSettingsOpen, false);
  });

  it("includes Authorization header in outgoing requests when token is configured", async () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "auth-token-456");
    const form = intakeForm();
    form.init();

    let capturedHeaders: Record<string, string> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
      capturedHeaders = (options?.headers as Record<string, string>) || {};
      return new Response(JSON.stringify({ ok: true, id: "tx-test" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      form.pressDigit(5);
      form.pressDigit(0);
      form.pressDigit(0);
      form.card = "Amex Gold";
      form.merchant = "Trader Joe's";

      const success = await form.submitTransaction();
      assert.strictEqual(success, true);
      assert.strictEqual(capturedHeaders.Authorization, "Bearer auth-token-456");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("intakeForm Recent Transactions Feed (Scenario 4)", () => {
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  it("fetches recent transactions when token is present", async () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "valid-token");
    const form = intakeForm();
    form.init();

    const sampleTransactions = [
      {
        id: "tx-1",
        date: "2026-09-30",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "George Howell",
        gross_amount: 15.0,
        reimbursement: 0.0,
        net_spend: 15.0,
        created_at: "2026-09-30 09:00:00",
      },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      assert.strictEqual(String(url), "/api/transactions?limit=5");
      return new Response(JSON.stringify({ transactions: sampleTransactions }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      await form.loadRecentTransactions();
      assert.strictEqual(form.recentTransactions.length, 1);
      assert.strictEqual(form.recentTransactions[0].merchant, "George Howell");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dynamically extracts and deduplicates cards from recent transactions", async () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "valid-token");
    const form = intakeForm();
    form.init();

    const sampleTransactions = [
      {
        id: "tx-1",
        date: "2026-09-30",
        card: "Chase Sapphire",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "George Howell",
        gross_amount: 15.0,
        reimbursement: 0.0,
        net_spend: 15.0,
        created_at: "2026-09-30 09:00:00",
      },
      {
        id: "tx-2",
        date: "2026-09-29",
        card: "Amex Gold",
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
        merchant: "Star Market",
        gross_amount: 50.0,
        reimbursement: 0.0,
        net_spend: 50.0,
        created_at: "2026-09-29 10:00:00",
      },
      {
        id: "tx-3",
        date: "2026-09-28",
        card: "Chase Sapphire",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Dig",
        gross_amount: 20.0,
        reimbursement: 0.0,
        net_spend: 20.0,
        created_at: "2026-09-28 12:00:00",
      },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ transactions: sampleTransactions }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      await form.loadRecentTransactions();
      assert.deepStrictEqual(form.cards, ["Chase Sapphire", "Amex Gold"]);
      assert.strictEqual(form.card, "Chase Sapphire");
      assert.strictEqual(form.isCustomCard, false);
      assert.strictEqual(
        mockStorage.getItem(CARDS_STORAGE_KEY),
        JSON.stringify(["Chase Sapphire", "Amex Gold"]),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves active custom card mode during background refresh", async () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "valid-token");
    const form = intakeForm();
    form.token = "valid-token";
    form.cards = ["Chase Sapphire"];
    form.card = "Chase Sapphire";
    form.toggleCustomCard();
    assert.strictEqual(form.isCustomCard, true);
    assert.strictEqual(form.autoCustomCard, false);
    assert.strictEqual(form.customCardInput, "");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          transactions: [
            {
              id: "tx-1",
              date: "2026-09-30",
              card: "Amex Gold",
              parent_bucket: "Guilt-Free",
              subcategory: "Dining",
              merchant: "Dig",
              gross_amount: 15.0,
              reimbursement: 0.0,
              net_spend: 15.0,
              created_at: "2026-09-30 09:00:00",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    try {
      await form.loadRecentTransactions();
      assert.strictEqual(form.isCustomCard, true);
      assert.deepStrictEqual(form.cards, ["Chase Sapphire", "Amex Gold"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("toggles recent transactions drawer and loads data if token configured", async () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "valid-token");
    const form = intakeForm();
    form.init();

    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ transactions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      assert.strictEqual(form.isRecentOpen, false);
      form.toggleRecent();
      assert.strictEqual(form.isRecentOpen, true);
      assert.strictEqual(fetchCalled, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles remote fetch errors gracefully without clearing existing recent transactions", async () => {
    const form = intakeForm();
    form.token = "valid-token";
    form.recentTransactions = [
      {
        id: "cached-1",
        date: "2026-09-30",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "George Howell",
        gross_amount: 15.0,
        reimbursement: 0.0,
        net_spend: 15.0,
        created_at: "2026-09-30 09:00:00",
      },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("Network offline");
    }) as unknown as typeof fetch;

    try {
      await form.loadRecentTransactions();
      assert.strictEqual(form.recentTransactions.length, 1);
      assert.strictEqual(form.recentTransactions[0].id, "cached-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("intakeForm Frequent Merchants Loading", () => {
  it("fetches frequent merchants and updates list", async () => {
    const form = intakeForm();
    form.token = "valid-token";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      assert.strictEqual(String(url), "/api/merchants?limit=8");
      return new Response(JSON.stringify({ merchants: ["Market Basket", "Star Market"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      await form.loadFrequentMerchants();
      assert.deepStrictEqual(form.frequentMerchants, ["Market Basket", "Star Market"]);
      assert.strictEqual(form.merchant, "Market Basket");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles merchant fetch errors gracefully without throwing", async () => {
    const form = intakeForm();
    form.token = "valid-token";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    try {
      await form.loadFrequentMerchants();
      assert.deepStrictEqual(form.frequentMerchants, DEFAULT_FREQUENT_MERCHANTS);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves currently selected merchant if present in fetched frequent merchants", async () => {
    const form = intakeForm();
    form.token = "valid-token";
    form.merchant = "Star Market";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ merchants: ["Market Basket", "Star Market", "Trader Joe's"] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      await form.loadFrequentMerchants();
      assert.strictEqual(form.merchant, "Star Market");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores in-flight merchant responses if token changed", async () => {
    const form = intakeForm();
    form.token = "initial-token";

    let resolveFetch: ((res: Response) => void) | undefined;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => pendingPromise) as unknown as typeof fetch;

    try {
      const loadPromise = form.loadFrequentMerchants();
      form.token = "new-token";
      if (resolveFetch) {
        resolveFetch(
          new Response(JSON.stringify({ merchants: ["Stale Merchant"] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      await loadPromise;
      assert.deepStrictEqual(form.frequentMerchants, DEFAULT_FREQUENT_MERCHANTS);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("intakeForm Primary Intake Date Handling (Scenario 5)", () => {
  it("defaults to today's local date without user interaction", async () => {
    const form = intakeForm();
    const today = getTodayDate();
    assert.strictEqual(form.date, today);
    assert.strictEqual(form.isToday, true);

    let postedPayload: Record<string, unknown> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
      postedPayload = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ ok: true, id: "tx-auto-date" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      form.pressDigit(2);
      form.pressDigit(5);
      form.pressDigit(0);
      form.card = "Chase Sapphire";
      form.merchant = "Blue Bottle";

      const success = await form.submitTransaction();
      assert.strictEqual(success, true);
      assert.strictEqual(postedPayload.date, today);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("intakeForm Secondary Date Selection & Reset (Scenario 6)", () => {
  it("allows setting a historical date and resets back to today upon submission", async () => {
    const form = intakeForm();
    const today = getTodayDate();
    const pastDate = "2026-09-20";

    form.setDate(pastDate);
    assert.strictEqual(form.date, pastDate);
    assert.strictEqual(form.isToday, false);
    assert.strictEqual(form.isBackfill, true);

    // Empty date input is safely ignored
    form.setDate("");
    assert.strictEqual(form.date, pastDate);

    let postedPayload: Record<string, unknown> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
      postedPayload = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ ok: true, id: "tx-backfill" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      form.pressDigit(1);
      form.pressDigit(0);
      form.pressDigit(0);
      form.card = "Amex Gold";
      form.merchant = "Trader Joe's";

      const success = await form.submitTransaction();
      assert.strictEqual(success, true);
      assert.strictEqual(postedPayload.date, pastDate);
      assert.strictEqual(form.date, today);
      assert.strictEqual(form.isToday, true);
      assert.strictEqual(form.isBackfill, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("intakeForm Submission Validation and Error Handling", () => {
  it("rejects submission when amount is zero", async () => {
    const form = intakeForm();
    form.amountCents = 0;
    form.card = "Amex Gold";
    form.merchant = "Trader Joe's";

    const result = await form.submitTransaction();
    assert.strictEqual(result, false);
    assert.strictEqual(form.isError, true);
    assert.strictEqual(form.statusMessage, "Please enter an amount");
  });

  it("rejects submission when card is empty or whitespace", async () => {
    const form = intakeForm();
    form.pressDigit(5);
    form.pressDigit(0);
    form.card = "   ";
    form.merchant = "Trader Joe's";

    const result = await form.submitTransaction();
    assert.strictEqual(result, false);
    assert.strictEqual(form.isError, true);
    assert.strictEqual(form.statusMessage, "Please select or enter a card");
  });

  it("rejects submission when merchant is empty or whitespace", async () => {
    const form = intakeForm();
    form.pressDigit(5);
    form.pressDigit(0);
    form.card = "Amex Gold";
    form.merchant = "   ";

    const result = await form.submitTransaction();
    assert.strictEqual(result, false);
    assert.strictEqual(form.isError, true);
    assert.strictEqual(form.statusMessage, "Please select or enter a merchant");
  });

  it("handles server-side rejection (HTTP 400)", async () => {
    const form = intakeForm();
    form.pressDigit(1);
    form.pressDigit(5);
    form.pressDigit(0);
    form.card = "Amex Gold";
    form.merchant = "Trader Joe's";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Validation failed" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await form.submitTransaction();
      assert.strictEqual(result, false);
      assert.strictEqual(form.syncError, "Validation failed");
      assert.strictEqual(form.deadLetterCount, 1);
      assert.match(form.persistentSyncMessage, /failed transaction/);
      assert.strictEqual(form.statusMessage, "Saved $1.50 at Trader Joe's");
    } finally {
      globalThis.fetch = originalFetch;
      await clearDeadLetterQueue();
    }
  });

  it("handles network failure by optimistically queueing in outbox", async () => {
    const form = intakeForm();
    form.pressDigit(1);
    form.pressDigit(5);
    form.pressDigit(0);
    form.card = "Amex Gold";
    form.merchant = "Trader Joe's";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("Failed to connect");
    }) as unknown as typeof fetch;

    try {
      const result = await form.submitTransaction();
      assert.strictEqual(result, true);
      assert.strictEqual(form.isError, false);
      assert.strictEqual(form.statusMessage, "Saved $1.50 at Trader Joe's");
      assert.strictEqual(form.amountCents, 0);
      assert.strictEqual(form.outboxCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves saved credit confirmation and queues for retry when backend rejects negative gross_amount due to rollback", async () => {
    const form = intakeForm();
    form.pressDigit(2);
    form.pressDigit(5);
    form.pressDigit(0);
    form.pressDigit(0);
    form.card = "Amex Gold";
    form.merchant = "Uniqlo";
    form.toggleNegative();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: "Validation failed: gross_amount must be a positive number" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    try {
      const result = await form.submitTransaction();
      assert.strictEqual(result, true);
      assert.strictEqual(form.isError, false);
      assert.strictEqual(form.statusMessage, "Saved credit of $25.00 at Uniqlo");
      assert.strictEqual(form.amountCents, 0);
      assert.strictEqual(form.isNegative, false);
      assert.strictEqual(form.outboxCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resets custom merchant state and selects first frequent merchant on successful submit", async () => {
    const form = intakeForm();
    form.pressDigit(2);
    form.pressDigit(5);
    form.pressDigit(0);
    form.card = "Amex Gold";
    form.toggleCustomMerchant();
    form.updateCustomMerchant("Neighborhood Pharmacy");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: true, id: "tx-custom-success" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const success = await form.submitTransaction();
      assert.strictEqual(success, true);
      assert.strictEqual(form.isCustomMerchant, false);
      assert.strictEqual(form.customMerchantInput, "");
      assert.strictEqual(form.merchant, DEFAULT_FREQUENT_MERCHANTS[0]);
      assert.strictEqual(form.statusMessage, "Saved $2.50 at Neighborhood Pharmacy");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks submission when loading is already in progress", async () => {
    const form = intakeForm();
    form.amountCents = 1500;
    form.card = "Amex Gold";
    form.merchant = "Trader Joe's";
    form.loading = true;

    const result = await form.submitTransaction();
    assert.strictEqual(result, false);
    assert.strictEqual(form.outboxCount, 0);
  });

  it("blocks rapid concurrent submissions via synchronous loading guard", async () => {
    const form = intakeForm();
    form.amountCents = 1500;
    form.card = "Amex Gold";
    form.merchant = "Trader Joe's";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: true, id: "tx-rapid" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const firstSubmit = form.submitTransaction();
      const secondSubmit = form.submitTransaction();

      const [res1, res2] = await Promise.all([firstSubmit, secondSubmit]);
      assert.strictEqual(res1, true);
      assert.strictEqual(res2, false);
      assert.strictEqual(form.loading, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("intakeForm Card Lifecycle and Storage", () => {
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  it("loads stored cards on init and sets first card as selected", () => {
    mockStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(["Apple Card", "Discover"]));
    const form = intakeForm();
    form.init();
    assert.deepStrictEqual(form.cards, ["Apple Card", "Discover"]);
    assert.strictEqual(form.card, "Apple Card");
    assert.strictEqual(form.isCustomCard, false);
  });

  it("sets isCustomCard to true on init when no cards exist", () => {
    const form = intakeForm();
    form.init();
    assert.deepStrictEqual(form.cards, []);
    assert.strictEqual(form.card, "");
    assert.strictEqual(form.isCustomCard, true);
  });

  it("ignores non-array or malformed data in localStorage cards", () => {
    mockStorage.setItem(CARDS_STORAGE_KEY, "not-json");
    const form = intakeForm();
    form.init();
    assert.deepStrictEqual(form.cards, []);
    assert.strictEqual(form.isCustomCard, true);

    mockStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify([123, null]));
    const form2 = intakeForm();
    form2.init();
    assert.deepStrictEqual(form2.cards, []);
    assert.strictEqual(form2.isCustomCard, true);
  });

  it("persists custom card and prepends to cards list on successful submission", async () => {
    const form = intakeForm();
    form.init();
    assert.strictEqual(form.isCustomCard, true);

    form.pressDigit(2);
    form.pressDigit(0);
    form.pressDigit(0);
    form.updateCustomCard("Bilt Mastercard");
    form.merchant = "Trader Joe's";

    let postedPayload: Record<string, unknown> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
      postedPayload = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ ok: true, id: "tx-custom-card" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const success = await form.submitTransaction();
      assert.strictEqual(success, true);
      assert.strictEqual(postedPayload.card, "Bilt Mastercard");
      assert.deepStrictEqual(form.cards, ["Bilt Mastercard"]);
      assert.strictEqual(form.card, "Bilt Mastercard");
      assert.strictEqual(form.isCustomCard, false);
      assert.strictEqual(form.customCardInput, "");
      assert.strictEqual(
        mockStorage.getItem(CARDS_STORAGE_KEY),
        JSON.stringify(["Bilt Mastercard"]),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not duplicate existing card in cards list when submitted as custom card", async () => {
    mockStorage.setItem(CARDS_STORAGE_KEY, JSON.stringify(["Bilt Mastercard"]));
    const form = intakeForm();
    form.init();

    form.toggleCustomCard();
    form.updateCustomCard("Bilt Mastercard");
    form.pressDigit(1);
    form.pressDigit(0);
    form.pressDigit(0);
    form.merchant = "Trader Joe's";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: true, id: "tx-dup-card" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const success = await form.submitTransaction();
      assert.strictEqual(success, true);
      assert.deepStrictEqual(form.cards, ["Bilt Mastercard"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("intakeForm Credit and Reimbursement Workflows (Issue #89)", () => {
  it("initializes in standard expense mode with isNegative=false", () => {
    const form = intakeForm();
    assert.strictEqual(form.isNegative, false);
    assert.strictEqual(form.submitButtonLabel, "Save Transaction");
    assert.strictEqual(form.grossAmount, 0);
    assert.strictEqual(form.netAmountCents, 0);
  });

  it("toggles negative credit mode, updates display with negative sign, and sets negative gross amount", () => {
    const form = intakeForm();
    form.pressDigit(3);
    form.pressDigit(5);
    form.pressDigit(0);
    form.pressDigit(0);
    assert.strictEqual(form.formattedAmount, "$35.00");
    assert.strictEqual(form.grossAmount, 35.0);
    assert.strictEqual(form.netAmountCents, 3500);

    form.toggleNegative();
    assert.strictEqual(form.isNegative, true);
    assert.strictEqual(form.grossAmount, -35.0);
    assert.strictEqual(form.netAmountCents, -3500);
    assert.strictEqual(form.submitButtonLabel, "Save Credit");

    form.toggleNegative();
    assert.strictEqual(form.isNegative, false);
    assert.strictEqual(form.grossAmount, 35.0);
    assert.strictEqual(form.netAmountCents, 3500);
    assert.strictEqual(form.submitButtonLabel, "Save Transaction");

    // Guard against mode changes while form is loading
    form.loading = true;
    form.toggleNegative();
    assert.strictEqual(form.isNegative, false);
    form.loading = false;
  });

  it("scales amountFontSizeClass responsively based on rendered character length", () => {
    const form = intakeForm();

    // Default $0.00 (5 chars) -> text-4xl sm:text-5xl
    assert.strictEqual(form.amountFontSizeClass, "text-4xl sm:text-5xl");

    // $999.99 (7 chars) -> text-4xl sm:text-5xl
    form.amountCents = 99999;
    assert.strictEqual(form.formattedAmount, "$999.99");
    assert.strictEqual(form.amountFontSizeClass, "text-4xl sm:text-5xl");

    // -$999.99 (8 chars) -> text-3xl sm:text-4xl
    form.isNegative = true;
    assert.strictEqual(form.amountFontSizeClass, "text-3xl sm:text-4xl");

    // $9999.99 (8 chars) -> text-3xl sm:text-4xl
    form.isNegative = false;
    form.amountCents = 999999;
    assert.strictEqual(form.formattedAmount, "$9999.99");
    assert.strictEqual(form.amountFontSizeClass, "text-3xl sm:text-4xl");

    // -$9999.99 (9 chars) -> text-3xl sm:text-4xl
    form.isNegative = true;
    assert.strictEqual(form.amountFontSizeClass, "text-3xl sm:text-4xl");

    // $10000.00 (9 chars) -> text-3xl sm:text-4xl
    form.isNegative = false;
    form.amountCents = 1000000;
    assert.strictEqual(form.formattedAmount, "$10000.00");
    assert.strictEqual(form.amountFontSizeClass, "text-3xl sm:text-4xl");

    // -$10000.00 (10 chars) -> text-2xl sm:text-3xl
    form.isNegative = true;
    assert.strictEqual(form.amountFontSizeClass, "text-2xl sm:text-3xl");

    // $100000.00 (10 chars) -> text-2xl sm:text-3xl
    form.isNegative = false;
    form.amountCents = 10000000;
    assert.strictEqual(form.formattedAmount, "$100000.00");
    assert.strictEqual(form.amountFontSizeClass, "text-2xl sm:text-3xl");

    // -$100000.00 (11 chars) -> text-2xl sm:text-3xl
    form.isNegative = true;
    assert.strictEqual(form.amountFontSizeClass, "text-2xl sm:text-3xl");

    // Clear restores text-4xl sm:text-5xl
    form.pressClear();
    form.isNegative = false;
    assert.strictEqual(form.amountFontSizeClass, "text-4xl sm:text-5xl");
  });

  it("submits credit transaction with negative gross_amount and zero reimbursement", async () => {
    const form = intakeForm();
    form.pressDigit(2);
    form.pressDigit(5);
    form.pressDigit(0);
    form.pressDigit(0);
    form.card = "Amex Gold";
    form.merchant = "Uniqlo";
    form.toggleNegative();

    const originalFetch = globalThis.fetch;
    let submittedPayload: unknown;
    globalThis.fetch = (async (_url: unknown, options: { body?: string }) => {
      if (options?.body) {
        submittedPayload = JSON.parse(options.body);
      }
      return new Response(JSON.stringify({ ok: true, id: "tx-credit-1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await form.submitTransaction();
      assert.strictEqual(result, true);
      assert.strictEqual(form.statusMessage, "Saved credit of $25.00 at Uniqlo");
      assert.strictEqual(form.isNegative, false);
      assert.strictEqual(form.amountCents, 0);

      const payload = submittedPayload as Record<string, unknown>;
      assert.strictEqual(payload.gross_amount, -25.0);
      assert.strictEqual(payload.reimbursement, 0.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("submits standalone non-salary inflow as positive Income -> Other", async () => {
    const form = intakeForm();
    form.selectBucket("Income");
    form.selectSubcategory("Other");
    form.pressDigit(4);
    form.pressDigit(0);
    form.pressDigit(0);
    form.toggleNegative();
    form.card = "Amex Gold";
    form.merchant = "Allowance";

    const originalFetch = globalThis.fetch;
    let submittedPayload: unknown;
    globalThis.fetch = (async (_url: unknown, options: { body?: string }) => {
      if (options?.body) {
        submittedPayload = JSON.parse(options.body);
      }
      return new Response(JSON.stringify({ ok: true, id: "tx-income-other" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await form.submitTransaction();

      assert.strictEqual(result, true);
      assert.strictEqual(form.isNegative, false);
      const payload = submittedPayload as Record<string, unknown>;
      assert.strictEqual(payload.parent_bucket, "Income");
      assert.strictEqual(payload.subcategory, "Other");
      assert.strictEqual(payload.gross_amount, 4);
      assert.strictEqual(payload.reimbursement, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("supports two-step reimbursement workflow where reimbursement offsets expense", async () => {
    const form = intakeForm();
    const originalFetch = globalThis.fetch;
    const submittedPayloads: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_url: unknown, options: { body?: string }) => {
      if (options?.body) {
        submittedPayloads.push(JSON.parse(options.body));
      }
      return new Response(JSON.stringify({ ok: true, id: `tx-${submittedPayloads.length}` }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      // Step 1: Log initial $120.00 dinner expense
      form.pressDigit(1);
      form.pressDigit(2);
      form.pressDigit(0);
      form.pressDigit(0);
      form.pressDigit(0);
      form.card = "Amex Gold";
      form.parentBucket = "Guilt-Free";
      form.subcategory = "Dining";
      form.merchant = "Osteria Posto";

      const step1Result = await form.submitTransaction();
      assert.strictEqual(step1Result, true);
      assert.strictEqual(form.isNegative, false);

      // Step 2: Friend sends $60.00 reimbursement 10 minutes later -> log -$60.00 credit to Dining
      form.pressDigit(6);
      form.pressDigit(0);
      form.pressDigit(0);
      form.pressDigit(0);
      form.toggleNegative();
      form.card = "Amex Gold";
      form.parentBucket = "Guilt-Free";
      form.subcategory = "Dining";
      form.merchant = "Venmo Reimbursement";

      const step2Result = await form.submitTransaction();
      assert.strictEqual(step2Result, true);
      assert.strictEqual(form.isNegative, false);

      assert.strictEqual(submittedPayloads.length, 2);
      assert.strictEqual(submittedPayloads[0].gross_amount, 120.0);
      assert.strictEqual(submittedPayloads[0].parent_bucket, "Guilt-Free");
      assert.strictEqual(submittedPayloads[0].subcategory, "Dining");
      assert.strictEqual(submittedPayloads[0].reimbursement, 0.0);
      assert.strictEqual(submittedPayloads[1].gross_amount, -60.0);
      assert.strictEqual(submittedPayloads[1].parent_bucket, "Guilt-Free");
      assert.strictEqual(submittedPayloads[1].subcategory, "Dining");
      assert.strictEqual(submittedPayloads[1].reimbursement, 0.0);

      // Verify net spend impact
      const netSpendTotal =
        (submittedPayloads[0].gross_amount as number) +
        (submittedPayloads[1].gross_amount as number);
      assert.strictEqual(netSpendTotal, 60.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("intakeForm Merchant Autocomplete Dropdown (#114)", () => {
  function createFakeKeydownEvent(
    key: string,
    isComposing = false,
  ): { event: KeyboardEvent; prevented: boolean } {
    let prevented = false;
    const event = {
      key,
      isComposing,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as KeyboardEvent;
    return {
      event,
      get prevented() {
        return prevented;
      },
    };
  }

  it("returns empty suggestions when customMerchantInput is empty or whitespace", () => {
    const form = intakeForm();
    form.allMerchants = ["Trader Joe's", "Tatte Bakery", "Whole Foods"];

    form.customMerchantInput = "";
    assert.deepStrictEqual(form.merchantSuggestions, []);

    form.customMerchantInput = "   ";
    assert.deepStrictEqual(form.merchantSuggestions, []);
  });

  it("filters suggestions case-insensitively by substring and deduplicates matches", () => {
    const form = intakeForm();
    form.allMerchants = [
      "Trader Joe's",
      "trader joe's",
      "TRADER JOE'S",
      "Tatte Bakery",
      "Estate Cafe",
    ];

    form.customMerchantInput = "tat";
    assert.deepStrictEqual(form.merchantSuggestions, ["Tatte Bakery", "Estate Cafe"]);
  });

  it("ranks prefix matches ahead of substring matches", () => {
    const form = intakeForm();
    form.allMerchants = ["Estate Cafe", "Tatte Bakery"];

    form.customMerchantInput = "tat";
    assert.deepStrictEqual(form.merchantSuggestions, ["Tatte Bakery", "Estate Cafe"]);
  });

  it("ranks matches by recency when prefix match status is equal", () => {
    const form = intakeForm();
    form.allMerchants = ["Tatte Bakery", "Tate's Bake Shop", "Tate Coffee"];
    form.recentTransactions = [
      {
        id: "tx-1",
        date: "2026-10-28",
        card: "Amex Gold",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Tate's Bake Shop",
        gross_amount: 12.5,
        reimbursement: 0,
        net_spend: 12.5,
        created_at: "2026-10-28T10:00:00Z",
      },
      {
        id: "tx-2",
        date: "2026-10-27",
        card: "CSR",
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        merchant: "Tatte Bakery",
        gross_amount: 8.0,
        reimbursement: 0,
        net_spend: 8.0,
        created_at: "2026-10-27T10:00:00Z",
      },
    ];

    form.customMerchantInput = "tat";
    // Tate's Bake Shop is more recent (tx-1, index 0) than Tatte Bakery (tx-2, index 1)
    // Tate Coffee is not in recents, so it ranks after
    assert.deepStrictEqual(form.merchantSuggestions, [
      "Tate's Bake Shop",
      "Tatte Bakery",
      "Tate Coffee",
    ]);
  });

  it("ranks matches by frequency when recency does not break ties", () => {
    const form = intakeForm();
    form.allMerchants = ["Tate's Cookies", "Tatte Bakery", "Tate Coffee"];
    form.recentTransactions = [];
    form.frequentMerchants = ["Tate Coffee", "Tatte Bakery", "Starbucks"];

    form.customMerchantInput = "tat";
    // Tate Coffee (freq index 0), Tatte Bakery (freq index 1), Tate's Cookies (not in freq)
    assert.deepStrictEqual(form.merchantSuggestions, [
      "Tate Coffee",
      "Tatte Bakery",
      "Tate's Cookies",
    ]);
  });

  it("falls back to alphabetical order and caps results at 5 items", () => {
    const form = intakeForm();
    form.allMerchants = ["Delta", "Echo", "Alpha", "Bravo", "Charlie", "Foxtrot", "Golf"];
    form.recentTransactions = [];
    form.frequentMerchants = [];

    // All contain letter 'o' (substring match)
    // Echo, Bravo, Foxtrot, Golf
    form.customMerchantInput = "o";
    const suggestions = form.merchantSuggestions;
    assert.deepStrictEqual(suggestions, ["Bravo", "Echo", "Foxtrot", "Golf"]);

    // Test cap of 5:
    form.allMerchants = ["M1", "M2", "M3", "M4", "M5", "M6", "M7"];
    form.customMerchantInput = "m";
    assert.strictEqual(form.merchantSuggestions.length, 5);
    assert.deepStrictEqual(form.merchantSuggestions, ["M1", "M2", "M3", "M4", "M5"]);
  });

  it("handles non-string or whitespace items in allMerchants safely", () => {
    const form = intakeForm();
    form.allMerchants = [
      null as unknown as string,
      undefined as unknown as string,
      "   ",
      "Tatte Bakery",
    ];

    form.customMerchantInput = "tat";
    assert.deepStrictEqual(form.merchantSuggestions, ["Tatte Bakery"]);
  });

  it("chooses a suggestion, updates input/merchant, applies defaults, and closes dropdown", () => {
    const form = intakeForm();
    form.allMerchants = ["Trader Joe's", "Tatte Bakery"];
    form.recentTransactions = [
      {
        id: "tx-tj",
        date: "2026-10-28",
        card: "Amex Gold",
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
        merchant: "Trader Joe's",
        gross_amount: 45.0,
        reimbursement: 0,
        net_spend: 45.0,
        created_at: "2026-10-28T12:00:00Z",
      },
    ];

    form.toggleCustomMerchant();
    form.updateCustomMerchant("tra");
    assert.strictEqual(form.merchantSuggestionsOpen, true);
    assert.deepStrictEqual(form.merchantSuggestions, ["Trader Joe's"]);

    form.chooseMerchantSuggestion("Trader Joe's");
    assert.strictEqual(form.customMerchantInput, "Trader Joe's");
    assert.strictEqual(form.merchant, "Trader Joe's");
    assert.strictEqual(form.merchantSuggestionsOpen, false);
    assert.strictEqual(form.highlightedMerchantIndex, -1);
    assert.strictEqual(form.parentBucket, "Fixed Costs");
    assert.strictEqual(form.subcategory, "Groceries");
  });

  it("ignores empty or whitespace suggestions in chooseMerchantSuggestion", () => {
    const form = intakeForm();
    form.customMerchantInput = "Existing";
    form.merchant = "Existing";

    form.chooseMerchantSuggestion("");
    assert.strictEqual(form.customMerchantInput, "Existing");

    form.chooseMerchantSuggestion("   ");
    assert.strictEqual(form.customMerchantInput, "Existing");
  });

  it("opens suggestions on focus when text is present and matches exist", () => {
    const form = intakeForm();
    form.allMerchants = ["Tatte Bakery"];
    form.customMerchantInput = "tat";
    form.merchantSuggestionsOpen = false;

    form.onCustomMerchantFocus();
    assert.strictEqual(form.merchantSuggestionsOpen, true);

    // Empty input: does not open on focus
    form.customMerchantInput = "";
    form.merchantSuggestionsOpen = false;
    form.onCustomMerchantFocus();
    assert.strictEqual(form.merchantSuggestionsOpen, false);

    // No matches: does not open on focus
    form.customMerchantInput = "xyz";
    form.merchantSuggestionsOpen = false;
    form.onCustomMerchantFocus();
    assert.strictEqual(form.merchantSuggestionsOpen, false);
  });

  it("closes suggestions when custom merchant input is cleared", () => {
    const form = intakeForm();
    form.allMerchants = ["Tatte Bakery"];
    form.updateCustomMerchant("tat");
    assert.strictEqual(form.merchantSuggestionsOpen, true);

    form.updateCustomMerchant("");
    assert.strictEqual(form.merchantSuggestionsOpen, false);
    assert.strictEqual(form.highlightedMerchantIndex, -1);
  });

  it("closes suggestions when toggling custom merchant or selecting a merchant chip", () => {
    const form = intakeForm();
    form.allMerchants = ["Tatte Bakery"];
    form.isCustomMerchant = true;
    form.updateCustomMerchant("tat");
    assert.strictEqual(form.merchantSuggestionsOpen, true);

    form.toggleCustomMerchant();
    assert.strictEqual(form.merchantSuggestionsOpen, false);
    assert.strictEqual(form.highlightedMerchantIndex, -1);

    form.toggleCustomMerchant();
    form.updateCustomMerchant("tat");
    assert.strictEqual(form.merchantSuggestionsOpen, true);

    form.selectMerchant("Whole Foods");
    assert.strictEqual(form.merchantSuggestionsOpen, false);
    assert.strictEqual(form.highlightedMerchantIndex, -1);
  });

  it("handles keyboard navigation: ArrowDown and ArrowUp when closed", () => {
    const form = intakeForm();
    form.allMerchants = ["Tatte Bakery", "Tate's", "Tate Coffee"];
    form.customMerchantInput = "tat";
    form.merchantSuggestionsOpen = false;

    // ArrowDown when closed opens suggestions and highlights index 0
    const downEvent = createFakeKeydownEvent("ArrowDown");
    form.handleCustomMerchantKeydown(downEvent.event);
    assert.strictEqual(downEvent.prevented, true);
    assert.strictEqual(form.merchantSuggestionsOpen, true);
    assert.strictEqual(form.highlightedMerchantIndex, 0);

    // Close and test ArrowUp when closed
    form.closeMerchantSuggestions();
    const upEvent = createFakeKeydownEvent("ArrowUp");
    form.handleCustomMerchantKeydown(upEvent.event);
    assert.strictEqual(upEvent.prevented, true);
    assert.strictEqual(form.merchantSuggestionsOpen, true);
    assert.strictEqual(form.highlightedMerchantIndex, 2);
  });

  it("handles keyboard navigation: cycling with ArrowDown and ArrowUp when open", () => {
    const form = intakeForm();
    form.allMerchants = ["Opt1", "Opt2", "Opt3"];
    form.customMerchantInput = "opt";
    form.merchantSuggestionsOpen = true;
    form.highlightedMerchantIndex = 0;

    // ArrowDown advances index
    const down1 = createFakeKeydownEvent("ArrowDown");
    form.handleCustomMerchantKeydown(down1.event);
    assert.strictEqual(down1.prevented, true);
    assert.strictEqual(form.highlightedMerchantIndex, 1);

    const down2 = createFakeKeydownEvent("ArrowDown");
    form.handleCustomMerchantKeydown(down2.event);
    assert.strictEqual(form.highlightedMerchantIndex, 2);

    // Wraps around to 0
    const down3 = createFakeKeydownEvent("ArrowDown");
    form.handleCustomMerchantKeydown(down3.event);
    assert.strictEqual(form.highlightedMerchantIndex, 0);

    // ArrowUp wraps around to 2
    const up1 = createFakeKeydownEvent("ArrowUp");
    form.handleCustomMerchantKeydown(up1.event);
    assert.strictEqual(up1.prevented, true);
    assert.strictEqual(form.highlightedMerchantIndex, 2);

    const up2 = createFakeKeydownEvent("ArrowUp");
    form.handleCustomMerchantKeydown(up2.event);
    assert.strictEqual(form.highlightedMerchantIndex, 1);
  });

  it("handles keyboard navigation: Enter selects highlighted item and prevents default", () => {
    const form = intakeForm();
    form.allMerchants = ["Tatte Bakery", "Whole Foods"];
    form.frequentMerchants = ["Tatte Bakery", "Whole Foods"];
    form.customMerchantInput = "t";
    form.merchantSuggestionsOpen = true;
    form.highlightedMerchantIndex = 0;

    const enterEvent = createFakeKeydownEvent("Enter");
    form.handleCustomMerchantKeydown(enterEvent.event);
    assert.strictEqual(enterEvent.prevented, true);
    assert.strictEqual(form.customMerchantInput, "Tatte Bakery");
    assert.strictEqual(form.merchantSuggestionsOpen, false);
    assert.strictEqual(form.highlightedMerchantIndex, -1);
  });

  it("handles keyboard navigation: Enter without highlight does not select or prevent default", () => {
    const form = intakeForm();
    form.allMerchants = ["Tatte Bakery"];
    form.customMerchantInput = "tat";
    form.merchantSuggestionsOpen = true;
    form.highlightedMerchantIndex = -1;

    const enterEvent = createFakeKeydownEvent("Enter");
    form.handleCustomMerchantKeydown(enterEvent.event);
    assert.strictEqual(enterEvent.prevented, false);
    assert.strictEqual(form.customMerchantInput, "tat");
    assert.strictEqual(form.merchantSuggestionsOpen, true);
  });

  it("handles keyboard navigation: Escape closes dropdown and prevents default", () => {
    const form = intakeForm();
    form.allMerchants = ["Tatte Bakery"];
    form.customMerchantInput = "tat";
    form.merchantSuggestionsOpen = true;
    form.highlightedMerchantIndex = 0;

    const escEvent = createFakeKeydownEvent("Escape");
    form.handleCustomMerchantKeydown(escEvent.event);
    assert.strictEqual(escEvent.prevented, true);
    assert.strictEqual(form.merchantSuggestionsOpen, false);
    assert.strictEqual(form.highlightedMerchantIndex, -1);
  });

  it("ignores unhandled keys and keys when no suggestions exist", () => {
    const form = intakeForm();
    form.allMerchants = [];
    form.customMerchantInput = "xyz";

    const downEvent = createFakeKeydownEvent("ArrowDown");
    form.handleCustomMerchantKeydown(downEvent.event);
    assert.strictEqual(downEvent.prevented, false);
    assert.strictEqual(form.merchantSuggestionsOpen, false);

    form.allMerchants = ["Tatte Bakery"];
    form.customMerchantInput = "tat";
    form.merchantSuggestionsOpen = true;
    const tabEvent = createFakeKeydownEvent("Tab");
    form.handleCustomMerchantKeydown(tabEvent.event);
    assert.strictEqual(tabEvent.prevented, false);
  });

  it("closes suggestions upon transaction submission", async () => {
    const form = intakeForm();
    form.amountCents = 1500;
    form.card = "Amex Gold";
    form.merchant = "Tatte Bakery";
    form.merchantSuggestionsOpen = true;
    form.highlightedMerchantIndex = 1;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: true, id: "tx-autocomplete" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const result = await form.submitTransaction();
      assert.strictEqual(result, true);
      assert.strictEqual(form.merchantSuggestionsOpen, false);
      assert.strictEqual(form.highlightedMerchantIndex, -1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("ignores keyboard navigation during IME composition", () => {
    const form = intakeForm();
    form.allMerchants = ["Tokyo Central", "Tokyo Mart"];
    form.customMerchantInput = "tok";
    form.merchantSuggestionsOpen = true;
    form.highlightedMerchantIndex = 0;

    const downEvent = createFakeKeydownEvent("ArrowDown", true);
    form.handleCustomMerchantKeydown(downEvent.event);
    assert.strictEqual(downEvent.prevented, false);
    assert.strictEqual(form.highlightedMerchantIndex, 0);

    const enterEvent = createFakeKeydownEvent("Enter", true);
    form.handleCustomMerchantKeydown(enterEvent.event);
    assert.strictEqual(enterEvent.prevented, false);
    assert.strictEqual(form.customMerchantInput, "tok");
  });

  it("closes suggestions on Escape even when suggestions list has no current matches", () => {
    const form = intakeForm();
    form.allMerchants = [];
    form.customMerchantInput = "xyz";
    form.merchantSuggestionsOpen = true;

    const escEvent = createFakeKeydownEvent("Escape");
    form.handleCustomMerchantKeydown(escEvent.event);
    assert.strictEqual(escEvent.prevented, true);
    assert.strictEqual(form.merchantSuggestionsOpen, false);
    assert.strictEqual(form.highlightedMerchantIndex, -1);
    assert.strictEqual(form.highlightedMerchant, null);
  });

  it("includes merchants from recent transactions in suggestions even when absent from allMerchants", () => {
    const form = intakeForm();
    form.allMerchants = ["Star Market"];
    form.recentTransactions = [
      {
        id: "tx-1",
        date: "2026-10-28",
        merchant: "Roche Bros",
        card: "Amex Gold",
        amount_cents: 2500,
        parent_bucket: "Fixed Costs",
        subcategory: "Groceries",
        currency: "USD",
        notes: null,
        created_at: "2026-10-28T12:00:00Z",
      },
    ];
    form.customMerchantInput = "roc";
    assert.deepStrictEqual(form.merchantSuggestions, ["Roche Bros"]);
  });

  it("extracts distinct merchants from recent transactions into allMerchants", async () => {
    const form = intakeForm();
    form.token = "valid-token";
    form.allMerchants = ["Existing Merchant"];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          transactions: [
            {
              id: "tx-2",
              date: "2026-10-28",
              merchant: "Brand New Merchant",
              card: "Amex Gold",
              amount_cents: 1200,
              parent_bucket: "Guilt-Free",
              subcategory: "Dining",
              currency: "USD",
              notes: null,
              created_at: "2026-10-28T14:00:00Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    try {
      await form.loadRecentTransactions();
      assert.ok(form.allMerchants.includes("Brand New Merchant"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves highlighted merchant by identity across suggestion reorders", () => {
    const form = intakeForm();
    form.allMerchants = ["Tate Coffee", "Tatte Bakery"];
    form.frequentMerchants = [];
    form.customMerchantInput = "tat";
    form.merchantSuggestionsOpen = true;

    // Highlight "Tate Coffee" at index 0
    form.highlightedMerchantIndex = 0;
    form.highlightedMerchant = "Tate Coffee";

    // Simulate recent transaction arriving that places "Tatte Bakery" ahead of "Tate Coffee"
    form.recentTransactions = [
      {
        id: "tx-tatte",
        date: "2026-10-28",
        merchant: "Tatte Bakery",
        card: "Amex Gold",
        amount_cents: 1500,
        parent_bucket: "Guilt-Free",
        subcategory: "Dining",
        currency: "USD",
        notes: null,
        created_at: "2026-10-28T10:00:00Z",
      },
    ];

    form.syncHighlightedMerchant();

    // "Tatte Bakery" is now index 0, "Tate Coffee" moved to index 1
    assert.deepStrictEqual(form.merchantSuggestions, ["Tatte Bakery", "Tate Coffee"]);
    assert.strictEqual(form.highlightedMerchantIndex, 1);
    assert.strictEqual(form.highlightedMerchant, "Tate Coffee");

    // Enter selects the intended "Tate Coffee"
    const enterEvent = createFakeKeydownEvent("Enter");
    form.handleCustomMerchantKeydown(enterEvent.event);
    assert.strictEqual(enterEvent.prevented, true);
    assert.strictEqual(form.customMerchantInput, "Tate Coffee");
  });

  it("resets highlighted merchant when it drops out of suggestions", () => {
    const form = intakeForm();
    form.allMerchants = ["Tate Coffee", "Tatte Bakery"];
    form.customMerchantInput = "tat";
    form.highlightedMerchantIndex = 0;
    form.highlightedMerchant = "Tate Coffee";

    // Remove "Tate Coffee" from merchants
    form.allMerchants = ["Tatte Bakery"];
    form.syncHighlightedMerchant();

    assert.strictEqual(form.highlightedMerchantIndex, -1);
    assert.strictEqual(form.highlightedMerchant, null);
  });
});
