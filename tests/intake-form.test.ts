import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  DEFAULT_CARDS,
  DEFAULT_FREQUENT_MERCHANTS,
  getTodayDate,
  intakeForm,
  TOKEN_STORAGE_KEY,
} from "../src/scripts/intake-form.ts";

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
});

describe("intakeForm Dynamic Subcategory Switching (Scenario 2)", () => {
  it("initializes with Guilt-Free and Dining selected", () => {
    const form = intakeForm();
    assert.strictEqual(form.parentBucket, "Guilt-Free");
    assert.strictEqual(form.subcategory, "Dining");
    assert.deepStrictEqual(form.subcategories, [
      "Dining",
      "Coffee",
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
    ]);

    form.selectBucket("Savings");
    assert.strictEqual(form.parentBucket, "Savings");
    assert.strictEqual(form.subcategory, "Emergency Fund");
    assert.deepStrictEqual(form.subcategories, ["Emergency Fund", "Investments", "Travel Fund"]);
  });

  it("allows selecting a specific subcategory within the active bucket", () => {
    const form = intakeForm();
    form.selectBucket("Guilt-Free");
    form.selectSubcategory("Coffee");
    assert.strictEqual(form.subcategory, "Coffee");
  });
});

describe("intakeForm Card and Merchant Selection", () => {
  it("allows selecting a card from the available card pills", () => {
    const form = intakeForm();
    assert.strictEqual(form.card, DEFAULT_CARDS[0]);
    form.selectCard("Chase Sapphire");
    assert.strictEqual(form.card, "Chase Sapphire");
  });

  it("allows selecting a merchant from frequent merchant pills", () => {
    const form = intakeForm();
    assert.strictEqual(form.merchant, DEFAULT_FREQUENT_MERCHANTS[0]);
    form.selectMerchant("George Howell");
    assert.strictEqual(form.merchant, "George Howell");
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

  it("removes token from localStorage and resets merchants and transactions when empty string is saved", () => {
    mockStorage.setItem(TOKEN_STORAGE_KEY, "existing-token");
    const form = intakeForm();
    form.token = "existing-token";
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
    assert.strictEqual(form.hasToken, false);
    assert.deepStrictEqual(form.frequentMerchants, DEFAULT_FREQUENT_MERCHANTS);
    assert.deepStrictEqual(form.recentTransactions, []);
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
    form.merchant = "Trader Joe's";

    const result = await form.submitTransaction();
    assert.strictEqual(result, false);
    assert.strictEqual(form.isError, true);
    assert.strictEqual(form.statusMessage, "Please enter an amount");
  });

  it("rejects submission when merchant is empty or whitespace", async () => {
    const form = intakeForm();
    form.pressDigit(5);
    form.pressDigit(0);
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
      assert.strictEqual(form.isError, true);
      assert.strictEqual(form.statusMessage, "Error: Validation failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles network failure gracefully", async () => {
    const form = intakeForm();
    form.pressDigit(1);
    form.pressDigit(5);
    form.pressDigit(0);
    form.merchant = "Trader Joe's";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("Failed to connect");
    }) as unknown as typeof fetch;

    try {
      const result = await form.submitTransaction();
      assert.strictEqual(result, false);
      assert.strictEqual(form.isError, true);
      assert.strictEqual(form.statusMessage, "Network error: Unable to reach endpoint");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
