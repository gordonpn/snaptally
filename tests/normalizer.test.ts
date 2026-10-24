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
    it("resolves every grocery chain rule to Fixed Costs Groceries", () => {
      const cases: readonly [string, string][] = [
        ["Costco", "Costco Wholesale"],
        ["Stop & Shop", "Stop & Shop"],
        ["Stop and Shop", "Stop & Shop"],
        ["Star Market", "Star Market"],
        ["Shaw's", "Shaw's"],
        ["Shaws", "Shaw's"],
        ["H-Mart", "H Mart"],
        ["H Mart", "H Mart"],
        ["Wegmans", "Wegmans"],
        ["Market Basket", "Market Basket"],
        ["T&T", "T&T Supermarket"],
        ["T&T Supermarket", "T&T Supermarket"],
        ["Kim Phat", "Kim Phat"],
        ["IGA", "IGA"],
        ["Maxi", "Maxi"],
        ["Walmart", "Walmart"],
      ];

      for (const [raw, canonical] of cases) {
        const result = normalizeMerchant(raw);

        assert.strictEqual(result.canonicalMerchant, canonical, raw);
        assert.strictEqual(result.parentBucket, "Fixed Costs", raw);
        assert.strictEqual(result.subcategory, "Groceries", raw);
        assert.strictEqual(result.matchStrategy, "exact_rule", raw);
      }
    });

    it("does not match grocery tokens embedded inside other words", () => {
      const result = normalizeMerchant("Bigarade");

      assert.strictEqual(result.matchStrategy, "unresolved");
      assert.strictEqual(result.parentBucket, null);
    });

    it("Scenario 1: evaluates Toast Blue Bottle Coffee into Guilt-Free Coffee & Snacks", () => {
      const result = normalizeMerchant("TST* BLUE BOTTLE COFFEE BOSTON MA");
      assert.strictEqual(result.paymentRail, "Toast");
      assert.strictEqual(result.cleanedDescription, "BLUE BOTTLE COFFEE");
      assert.strictEqual(result.canonicalMerchant, "Blue Bottle Coffee");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Coffee & Snacks");
      assert.strictEqual(result.rewardCategory, "Dining");
      assert.strictEqual(result.matchStrategy, "exact_rule");
      assert.strictEqual(result.requiresLLM, false);
      assert.strictEqual(result.confidence, 0.98);
    });

    it("Scenario 2: evaluates Square Tatte Bakery into Guilt-Free Coffee & Snacks", () => {
      const result = normalizeMerchant("SQ *TATTE BAKERY & CAFE #14 CAMBRIDGE MA 02138");
      assert.strictEqual(result.paymentRail, "Square");
      assert.strictEqual(result.cleanedDescription, "TATTE BAKERY & CAFE");
      assert.strictEqual(result.canonicalMerchant, "Tatte Bakery & Cafe");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Coffee & Snacks");
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

    it("evaluates Uber Eats, DoorDash, Chipotle, and Shake Shack into Guilt-Free Takeout", () => {
      const uberEats = normalizeMerchant("UBER EATS PENDING");
      assert.strictEqual(uberEats.canonicalMerchant, "Uber Eats");
      assert.strictEqual(uberEats.parentBucket, "Guilt-Free");
      assert.strictEqual(uberEats.subcategory, "Takeout");

      const doordash = normalizeMerchant("DOORDASH*BURGER CAMBRIDGE MA");
      assert.strictEqual(doordash.canonicalMerchant, "DoorDash");
      assert.strictEqual(doordash.parentBucket, "Guilt-Free");
      assert.strictEqual(doordash.subcategory, "Takeout");

      const chipotle = normalizeMerchant("CHIPOTLE 1234 BOSTON MA");
      assert.strictEqual(chipotle.canonicalMerchant, "Chipotle Mexican Grill");
      assert.strictEqual(chipotle.parentBucket, "Guilt-Free");
      assert.strictEqual(chipotle.subcategory, "Takeout");

      const shakeShack = normalizeMerchant("SHAKE SHACK #102");
      assert.strictEqual(shakeShack.canonicalMerchant, "Shake Shack");
      assert.strictEqual(shakeShack.parentBucket, "Guilt-Free");
      assert.strictEqual(shakeShack.subcategory, "Takeout");
    });

    it("evaluates Berryline ice cream into Guilt-Free Coffee & Snacks", () => {
      const result = normalizeMerchant("SQ *BERRYLINE CAMBRIDGE MA");
      assert.strictEqual(result.canonicalMerchant, "Berryline");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Coffee & Snacks");
      assert.strictEqual(result.rewardCategory, "Dining");
    });

    it("matches contextual regex rules for unmapped cafe and snacks", () => {
      const result = normalizeMerchant("TST* CORNER ARTISAN ROASTERY SOMERVILLE MA");
      assert.strictEqual(result.matchStrategy, "regex_heuristic");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Coffee & Snacks");
      assert.strictEqual(result.requiresLLM, false);
      assert.strictEqual(result.confidence, 0.88);
    });

    it("matches contextual regex rules for unmapped fast food and food delivery", () => {
      const result = normalizeMerchant("EXPRESS FAST FOOD DELIVERY");
      assert.strictEqual(result.matchStrategy, "regex_heuristic");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Takeout");
      assert.strictEqual(result.requiresLLM, false);
      assert.strictEqual(result.confidence, 0.88);
    });

    it("evaluates McDonald's descriptors deterministically into Guilt-Free Takeout", () => {
      const result = normalizeMerchant("MCDONALDS #102 BOSTON MA");
      assert.strictEqual(result.canonicalMerchant, "McDonald's");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Takeout");
      assert.strictEqual(result.rewardCategory, "Dining");
      assert.strictEqual(result.confidence, 0.98);

      const apostropheVariant = normalizeMerchant("MCDONALD'S 4821 SOMERVILLE MA");
      assert.strictEqual(apostropheVariant.canonicalMerchant, "McDonald's");
      assert.strictEqual(apostropheVariant.parentBucket, "Guilt-Free");
      assert.strictEqual(apostropheVariant.subcategory, "Takeout");
    });

    it("does not classify non-food merchants containing standalone TEA as Coffee & Snacks", () => {
      const result = normalizeMerchant("TEA COLLECTION KIDS CLOTHING");
      assert.strictEqual(result.matchStrategy, "unresolved");
      assert.strictEqual(result.requiresLLM, true);
      assert.strictEqual(result.parentBucket, null);
      assert.strictEqual(result.subcategory, null);
    });

    it("matches beverage tea phrases as Cafe & Bakery under Coffee & Snacks", () => {
      const bobaResult = normalizeMerchant("HAPPY LEMON BOBA TEA");
      assert.strictEqual(bobaResult.matchStrategy, "regex_heuristic");
      assert.strictEqual(bobaResult.parentBucket, "Guilt-Free");
      assert.strictEqual(bobaResult.subcategory, "Coffee & Snacks");

      const teaShopResult = normalizeMerchant("ARTISAN LEAF TEA SHOP BOSTON MA");
      assert.strictEqual(teaShopResult.matchStrategy, "regex_heuristic");
      assert.strictEqual(teaShopResult.parentBucket, "Guilt-Free");
      assert.strictEqual(teaShopResult.subcategory, "Coffee & Snacks");
    });

    it("classifies tea markets as Groceries under Fixed Costs rather than snacks", () => {
      const result = normalizeMerchant("ASIAN TEA MARKET BOSTON MA");
      assert.strictEqual(result.matchStrategy, "regex_heuristic");
      assert.strictEqual(result.parentBucket, "Fixed Costs");
      assert.strictEqual(result.subcategory, "Groceries");
    });

    it("preserves restaurant classification when descriptors contain MARKET", () => {
      const result = normalizeMerchant("THE MARKET RESTAURANT");
      assert.strictEqual(result.matchStrategy, "regex_heuristic");
      assert.strictEqual(result.parentBucket, "Guilt-Free");
      assert.strictEqual(result.subcategory, "Dining");
      assert.strictEqual(result.rewardCategory, "Dining");
    });

    it("does not classify non-transit merchants with METRO or PATH as transit", () => {
      const metroDiner = normalizeMerchant("METRO DINER");
      assert.strictEqual(metroDiner.matchStrategy, "regex_heuristic");
      assert.strictEqual(metroDiner.parentBucket, "Guilt-Free");
      assert.strictEqual(metroDiner.subcategory, "Dining");

      const metroMobile = normalizeMerchant("METRO BY T-MOBILE");
      assert.strictEqual(metroMobile.matchStrategy, "unresolved");
      assert.strictEqual(metroMobile.requiresLLM, true);
      assert.strictEqual(metroMobile.parentBucket, null);

      const pathSoftware = normalizeMerchant("CRITICAL PATH SOFTWARE");
      assert.strictEqual(pathSoftware.matchStrategy, "unresolved");
      assert.strictEqual(pathSoftware.requiresLLM, true);
      assert.strictEqual(pathSoftware.parentBucket, null);

      const pathTrain = normalizeMerchant("PATH TRAIN");
      assert.strictEqual(pathTrain.matchStrategy, "regex_heuristic");
      assert.strictEqual(pathTrain.parentBucket, "Fixed Costs");
      assert.strictEqual(pathTrain.subcategory, "Transit");
    });

    it("classifies transit subway descriptors as Transit under Fixed Costs", () => {
      const mtaResult = normalizeMerchant("MTA SUBWAY FARE");
      assert.strictEqual(mtaResult.matchStrategy, "regex_heuristic");
      assert.strictEqual(mtaResult.parentBucket, "Fixed Costs");
      assert.strictEqual(mtaResult.subcategory, "Transit");
      assert.strictEqual(mtaResult.rewardCategory, "Travel");
      assert.strictEqual(mtaResult.requiresLLM, false);

      const subwayFareResult = normalizeMerchant("SUBWAY FARE BOSTON MA");
      assert.strictEqual(subwayFareResult.matchStrategy, "regex_heuristic");
      assert.strictEqual(subwayFareResult.parentBucket, "Fixed Costs");
      assert.strictEqual(subwayFareResult.subcategory, "Transit");

      const omnyResult = normalizeMerchant("OMNY NYCT PAYGO");
      assert.strictEqual(omnyResult.matchStrategy, "regex_heuristic");
      assert.strictEqual(omnyResult.parentBucket, "Fixed Costs");
      assert.strictEqual(omnyResult.subcategory, "Transit");
    });

    it("classifies subway restaurant descriptors with food or store context as Takeout", () => {
      const sandwichResult = normalizeMerchant("SUBWAY SANDWICHES BOSTON MA");
      assert.strictEqual(sandwichResult.canonicalMerchant, "Subway");
      assert.strictEqual(sandwichResult.parentBucket, "Guilt-Free");
      assert.strictEqual(sandwichResult.subcategory, "Takeout");
      assert.strictEqual(sandwichResult.rewardCategory, "Dining");

      const restaurantResult = normalizeMerchant("SUBWAY RESTAURANT #12345 CAMBRIDGE MA");
      assert.strictEqual(restaurantResult.canonicalMerchant, "Subway");
      assert.strictEqual(restaurantResult.parentBucket, "Guilt-Free");
      assert.strictEqual(restaurantResult.subcategory, "Takeout");

      const hashStoreResult = normalizeMerchant("SUBWAY #12345 CAMBRIDGE MA");
      assert.strictEqual(hashStoreResult.canonicalMerchant, "Subway");
      assert.strictEqual(hashStoreResult.parentBucket, "Guilt-Free");
      assert.strictEqual(hashStoreResult.subcategory, "Takeout");

      const storeKeywordResult = normalizeMerchant("SUBWAY STORE #456");
      assert.strictEqual(storeKeywordResult.canonicalMerchant, "Subway");
      assert.strictEqual(storeKeywordResult.parentBucket, "Guilt-Free");
      assert.strictEqual(storeKeywordResult.subcategory, "Takeout");

      const bareStoreIdResult = normalizeMerchant("SUBWAY 9876 BOSTON MA");
      assert.strictEqual(bareStoreIdResult.canonicalMerchant, "Subway");
      assert.strictEqual(bareStoreIdResult.parentBucket, "Guilt-Free");
      assert.strictEqual(bareStoreIdResult.subcategory, "Takeout");
    });

    it("evaluates rollout takeout and coffee snack merchants deterministically", () => {
      const grubhub = normalizeMerchant("GRUBHUB*12345");
      assert.strictEqual(grubhub.canonicalMerchant, "Grubhub");
      assert.strictEqual(grubhub.parentBucket, "Guilt-Free");
      assert.strictEqual(grubhub.subcategory, "Takeout");

      const cava = normalizeMerchant("CAVA 1234");
      assert.strictEqual(cava.canonicalMerchant, "Cava");
      assert.strictEqual(cava.parentBucket, "Guilt-Free");
      assert.strictEqual(cava.subcategory, "Takeout");

      const panda = normalizeMerchant("PANDA EXPRESS 123");
      assert.strictEqual(panda.canonicalMerchant, "Panda Express");
      assert.strictEqual(panda.parentBucket, "Guilt-Free");
      assert.strictEqual(panda.subcategory, "Takeout");

      const insomnia = normalizeMerchant("INSOMNIA COOKIES #10");
      assert.strictEqual(insomnia.canonicalMerchant, "Insomnia Cookies");
      assert.strictEqual(insomnia.parentBucket, "Guilt-Free");
      assert.strictEqual(insomnia.subcategory, "Coffee & Snacks");

      const saltStraw = normalizeMerchant("SALT & STRAW CAMBRIDGE MA");
      assert.strictEqual(saltStraw.canonicalMerchant, "Salt & Straw");
      assert.strictEqual(saltStraw.parentBucket, "Guilt-Free");
      assert.strictEqual(saltStraw.subcategory, "Coffee & Snacks");

      const amorino = normalizeMerchant("AMORINO GELATO BOSTON");
      assert.strictEqual(amorino.canonicalMerchant, "Amorino");
      assert.strictEqual(amorino.parentBucket, "Guilt-Free");
      assert.strictEqual(amorino.subcategory, "Coffee & Snacks");

      const flour = normalizeMerchant("FLOUR BAKERY + CAFE");
      assert.strictEqual(flour.canonicalMerchant, "Flour Bakery");
      assert.strictEqual(flour.parentBucket, "Guilt-Free");
      assert.strictEqual(flour.subcategory, "Coffee & Snacks");
    });

    it("leaves ambiguous bare SUBWAY without food or transit context for LLM fallback", () => {
      const bareResult = normalizeMerchant("SUBWAY");
      assert.strictEqual(bareResult.matchStrategy, "unresolved");
      assert.strictEqual(bareResult.requiresLLM, true);
      assert.strictEqual(bareResult.parentBucket, null);
      assert.strictEqual(bareResult.subcategory, null);
    });

    it("does not classify non-food delivery as Takeout", () => {
      const result = normalizeMerchant("FEDEX PARCEL DELIVERY EXPRESS");
      assert.notStrictEqual(result.subcategory, "Takeout");
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

    it("evaluates climbing gym descriptors into Fixed Costs Fitness", () => {
      const blocShop = normalizeMerchant("BLOC SHOP HOCHELAGA");
      assert.strictEqual(blocShop.canonicalMerchant, "Bloc Shop");
      assert.strictEqual(blocShop.parentBucket, "Fixed Costs");
      assert.strictEqual(blocShop.subcategory, "Fitness");

      const crg = normalizeMerchant("CENTRAL ROCK GYM CAMBRIDGE");
      assert.strictEqual(crg.canonicalMerchant, "Central Rock Gym");
      assert.strictEqual(crg.parentBucket, "Fixed Costs");
      assert.strictEqual(crg.subcategory, "Fitness");

      const crgAbbr = normalizeMerchant("CRG WATERTOWN");
      assert.strictEqual(crgAbbr.canonicalMerchant, "Central Rock Gym");
      assert.strictEqual(crgAbbr.parentBucket, "Fixed Costs");
      assert.strictEqual(crgAbbr.subcategory, "Fitness");

      const contextualBouldering = normalizeMerchant("METRO BOULDERING CO");
      assert.strictEqual(contextualBouldering.matchStrategy, "regex_heuristic");
      assert.strictEqual(contextualBouldering.parentBucket, "Fixed Costs");
      assert.strictEqual(contextualBouldering.subcategory, "Fitness");

      const fitnessWithMarket = normalizeMerchant("PLANET FITNESS MARKET STREET");
      assert.strictEqual(fitnessWithMarket.matchStrategy, "regex_heuristic");
      assert.strictEqual(fitnessWithMarket.canonicalMerchant, "Planet Fitness Market Street");
      assert.strictEqual(fitnessWithMarket.parentBucket, "Fixed Costs");
      assert.strictEqual(fitnessWithMarket.subcategory, "Fitness");
    });

    it("evaluates mental therapy descriptors into Fixed Costs Healthcare", () => {
      const therapyExact = normalizeMerchant("THERAPY");
      assert.strictEqual(therapyExact.matchStrategy, "regex_heuristic");
      assert.strictEqual(therapyExact.canonicalMerchant, "Therapy");
      assert.strictEqual(therapyExact.parentBucket, "Fixed Costs");
      assert.strictEqual(therapyExact.subcategory, "Healthcare");

      const therapyMultiWord = normalizeMerchant("CAMBRIDGE THERAPY GROUP");
      assert.strictEqual(therapyMultiWord.matchStrategy, "regex_heuristic");
      assert.strictEqual(therapyMultiWord.canonicalMerchant, "Cambridge Therapy Group");
      assert.strictEqual(therapyMultiWord.parentBucket, "Fixed Costs");
      assert.strictEqual(therapyMultiWord.subcategory, "Healthcare");

      const psychotherapy = normalizeMerchant("CAMBRIDGE PSYCHOTHERAPY GROUP");
      assert.strictEqual(psychotherapy.matchStrategy, "regex_heuristic");
      assert.strictEqual(psychotherapy.parentBucket, "Fixed Costs");
      assert.strictEqual(psychotherapy.subcategory, "Healthcare");
    });
  });
});
