import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanRawDescriptor,
  normalizeMerchant,
  toTitleCase,
} from "../src/utils/merchant-normalizer.ts";

describe("Merchant Normalizer", () => {
  describe("toTitleCase", () => {
    it("capitalizes words while preserving hyphens and numbers", () => {
      assert.strictEqual(toTitleCase("7-ELEVEN"), "7-Eleven");
      assert.strictEqual(toTitleCase("STUDIO 54 CAFE"), "Studio 54 Cafe");
      assert.strictEqual(toTitleCase("TATTE BAKERY & CAFE"), "Tatte Bakery & Cafe");
      assert.strictEqual(toTitleCase("BLUE BOTTLE COFFEE"), "Blue Bottle Coffee");
      assert.strictEqual(toTitleCase(""), "");
    });
  });

  describe("cleanRawDescriptor", () => {
    it("Scenario 1: isolates Toast payment rail and extracts merchant string", () => {
      const result = cleanRawDescriptor("TST* BLUE BOTTLE COFFEE BOSTON MA");
      assert.strictEqual(result.rail, "Toast");
      assert.strictEqual(result.cleaned, "BLUE BOTTLE COFFEE");
    });

    it("Scenario 2: isolates Square rail and removes store numbers, cities, and zip codes", () => {
      const result = cleanRawDescriptor("SQ *TATTE BAKERY & CAFE #14 CAMBRIDGE MA 02138");
      assert.strictEqual(result.rail, "Square");
      assert.strictEqual(result.cleaned, "TATTE BAKERY & CAFE");
    });

    it("Scenario 4: preserves legitimate numbers in merchant names", () => {
      const sevenEleven = cleanRawDescriptor("7-ELEVEN STORE #0482 BOSTON MA");
      assert.strictEqual(sevenEleven.cleaned, "7-ELEVEN");

      const studio54 = cleanRawDescriptor("STUDIO 54 CAFE");
      assert.strictEqual(studio54.cleaned, "STUDIO 54 CAFE");
    });

    it("preserves non-trailing city names in merchant brand names like Boston Market", () => {
      const result = cleanRawDescriptor("BOSTON MARKET STORE #12");
      assert.strictEqual(result.cleaned, "BOSTON MARKET");
    });

    it("isolates PayPal payment rail", () => {
      const result = cleanRawDescriptor("PAYPAL *GITHUB SAN JOSE CA");
      assert.strictEqual(result.rail, "PayPal");
      assert.strictEqual(result.cleaned, "GITHUB");
    });

    it("isolates Stripe payment rail for STRIPE* and SP* shorthand", () => {
      const stripeFull = cleanRawDescriptor("STRIPE *VERCEL INC SAN FRANCISCO CA");
      assert.strictEqual(stripeFull.rail, "Stripe");
      assert.strictEqual(stripeFull.cleaned, "VERCEL INC");

      const stripeShort = cleanRawDescriptor("SP*OPENAI SAN FRANCISCO CA");
      assert.strictEqual(stripeShort.rail, "Stripe");
      assert.strictEqual(stripeShort.cleaned, "OPENAI");
    });

    it("isolates Shopify payment rail for SHOPIFY* and SP space prefix", () => {
      const shopifyFull = cleanRawDescriptor("SHOPIFY * ALLBIRDS BOSTON MA");
      assert.strictEqual(shopifyFull.rail, "Shopify");
      assert.strictEqual(shopifyFull.cleaned, "ALLBIRDS");

      const shopifyShort = cleanRawDescriptor("SP ALLBIRDS BOSTON MA");
      assert.strictEqual(shopifyShort.rail, "Shopify");
      assert.strictEqual(shopifyShort.cleaned, "ALLBIRDS");
    });

    it("isolates Venmo payment rail", () => {
      const result = cleanRawDescriptor("VENMO *SPLIT PAYMENT");
      assert.strictEqual(result.rail, "Venmo");
      assert.strictEqual(result.cleaned, "SPLIT PAYMENT");
    });

    it("isolates ApplePay payment rail and strips domain names and phone numbers", () => {
      const result = cleanRawDescriptor("APL* ITUNES.COM/BILL 866-712-7753 CA");
      assert.strictEqual(result.rail, "ApplePay");
      assert.strictEqual(result.cleaned, "ITUNES");
    });

    it("strips bank authorization prefixes and trailing store tokens", () => {
      const result = cleanRawDescriptor(
        "PURCHASE AUTHORIZED ON 10/12 AMZN Mktp US*2G81A09 SEATTLE WA",
      );
      assert.strictEqual(result.cleaned, "AMZN MKTP US 2G81A09");
    });

    it("strips POS debit and Checkcard prefixes", () => {
      const posDebit = cleanRawDescriptor("POS DEBIT - STARBUCKS #1234");
      assert.strictEqual(posDebit.cleaned, "STARBUCKS");

      const checkcard = cleanRawDescriptor("CHECKCARD 10/12 WHOLE FOODS");
      assert.strictEqual(checkcard.cleaned, "WHOLE FOODS");
    });
  });

  describe("normalizeMerchant", () => {
    it("Scenario 1: evaluates Toast Blue Bottle Coffee into Guilt-Free Coffee", () => {
      const result = normalizeMerchant("TST* BLUE BOTTLE COFFEE BOSTON MA");
      assert.strictEqual(result.paymentRail, "Toast");
      assert.strictEqual(result.cleanedDescription, "BLUE BOTTLE COFFEE");
      assert.strictEqual(result.canonicalMerchant, "Blue Bottle Coffee");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Coffee");
      assert.strictEqual(result.rewardCategory, "Dining");
      assert.strictEqual(result.matchStrategy, "exact_rule");
      assert.strictEqual(result.requiresLLM, false);
      assert.strictEqual(result.confidence, 0.98);
    });

    it("Scenario 2: evaluates Square Tatte Bakery into Guilt-Free Dining", () => {
      const result = normalizeMerchant("SQ *TATTE BAKERY & CAFE #14 CAMBRIDGE MA 02138");
      assert.strictEqual(result.paymentRail, "Square");
      assert.strictEqual(result.cleanedDescription, "TATTE BAKERY & CAFE");
      assert.strictEqual(result.canonicalMerchant, "Tatte Bakery & Cafe");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Dining");
      assert.strictEqual(result.rewardCategory, "Dining");
      assert.strictEqual(result.matchStrategy, "exact_rule");
      assert.strictEqual(result.requiresLLM, false);
      assert.strictEqual(result.confidence, 0.98);
    });

    it("Scenario 3: prioritizes greedy longest token AMAZON PRIME over AMAZON", () => {
      const primeResult = normalizeMerchant("AMAZON PRIME 800-555-0199 WA");
      assert.strictEqual(primeResult.canonicalMerchant, "Amazon Prime");
      assert.strictEqual(primeResult.parentBucket, "Fixed Costs");
      assert.strictEqual(primeResult.subcategory, "Subscriptions");
      assert.strictEqual(primeResult.matchStrategy, "exact_rule");
      assert.strictEqual(primeResult.requiresLLM, false);

      const genericAmazon = normalizeMerchant("AMAZON 800-555-0199 WA");
      assert.strictEqual(genericAmazon.canonicalMerchant, "Amazon");
      assert.strictEqual(genericAmazon.parentBucket, "Guilt-Free");
      assert.strictEqual(genericAmazon.subcategory, "Shopping");
      assert.strictEqual(genericAmazon.matchStrategy, "exact_rule");
      assert.strictEqual(genericAmazon.requiresLLM, false);
    });

    it("correctly classifies Boston Market as Guilt-Free Dining", () => {
      const result = normalizeMerchant("BOSTON MARKET STORE #014");
      assert.strictEqual(result.canonicalMerchant, "Boston Market");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Dining");
      assert.strictEqual(result.matchStrategy, "exact_rule");
      assert.strictEqual(result.requiresLLM, false);
    });

    it("matches bank abbreviation WHOLEFDS to Whole Foods Market", () => {
      const result = normalizeMerchant("WHOLEFDS SOU #10243 BOSTON MA");
      assert.strictEqual(result.canonicalMerchant, "Whole Foods Market");
      assert.strictEqual(result.parentBucket, "Fixed Costs");
      assert.strictEqual(result.subcategory, "Groceries");
      assert.strictEqual(result.rewardCategory, "Groceries");
      assert.strictEqual(result.matchStrategy, "exact_rule");
      assert.strictEqual(result.requiresLLM, false);
    });

    it("matches contextual regex rules for unmapped cafe", () => {
      const result = normalizeMerchant("TST* CORNER ARTISAN ROASTERY SOMERVILLE MA");
      assert.strictEqual(result.matchStrategy, "regex_heuristic");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Coffee");
      assert.strictEqual(result.requiresLLM, false);
      assert.strictEqual(result.confidence, 0.88);
    });

    it("matches contextual regex rules for pharmacy", () => {
      const result = normalizeMerchant("LOCAL CORNER DRUGS PHARMACY");
      assert.strictEqual(result.matchStrategy, "regex_heuristic");
      assert.strictEqual(result.parentBucket, "Fixed Costs");
      assert.strictEqual(result.subcategory, "Groceries");
      assert.strictEqual(result.rewardCategory, "Drugstores");
      assert.strictEqual(result.requiresLLM, false);
    });

    it("matches contextual regex rules for parking operator", () => {
      const result = normalizeMerchant("PARKMOBILE LOT 482");
      assert.strictEqual(result.matchStrategy, "regex_heuristic");
      assert.strictEqual(result.parentBucket, "Fixed Costs");
      assert.strictEqual(result.subcategory, "Transit");
      assert.strictEqual(result.rewardCategory, "Travel");
      assert.strictEqual(result.requiresLLM, false);
    });

    it("applies aggregator heuristic fallback for unrecognized Toast merchant", () => {
      const result = normalizeMerchant("TST* UNMAPPED LOCAL MYSTERY ENTITY");
      assert.strictEqual(result.paymentRail, "Toast");
      assert.strictEqual(result.matchStrategy, "aggregator_heuristic");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Dining");
      assert.strictEqual(result.rewardCategory, "Dining");
      assert.strictEqual(result.requiresLLM, false);
      assert.strictEqual(result.confidence, 0.82);
    });

    it("routes unmapped and low-confidence descriptors to LLM fallback", () => {
      const result = normalizeMerchant("FANCY VINTAGE THRIFT CLOTHING SOMERVILLE");
      assert.strictEqual(result.canonicalMerchant, "Fancy Vintage Thrift Clothing");
      assert.strictEqual(result.parentBucket, null);
      assert.strictEqual(result.subcategory, null);
      assert.strictEqual(result.rewardCategory, null);
      assert.strictEqual(result.matchStrategy, "unresolved");
      assert.strictEqual(result.requiresLLM, true);
      assert.strictEqual(result.confidence, 0.2);
    });

    it("handles empty or whitespace-only descriptors gracefully", () => {
      const result = normalizeMerchant("   ");
      assert.strictEqual(result.cleanedDescription, "");
      assert.strictEqual(result.canonicalMerchant, "Unknown Merchant");
      assert.strictEqual(result.requiresLLM, true);
      assert.strictEqual(result.confidence, 0.0);
    });
  });
});
