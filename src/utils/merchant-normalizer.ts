/**
 * Deterministic transaction normalizer and payment rail extractor.
 * Pre-processes noisy point-of-sale descriptors into canonical entities
 * and Conscious Spending Plan categories.
 */

import type { ParentBucket, Subcategory } from "../config/intake.ts";

export type PaymentRail =
  | "Toast"
  | "Square"
  | "PayPal"
  | "Stripe"
  | "Shopify"
  | "Venmo"
  | "ApplePay";

export type MatchStrategy =
  | "exact_rule"
  | "regex_heuristic"
  | "aggregator_heuristic"
  | "unresolved";

export interface CategoryRule {
  readonly canonicalName: string;
  readonly parentBucket: ParentBucket;
  readonly subcategory: Subcategory;
  readonly rewardMultiplierCategory?: string;
}

export interface NormalizedTransaction {
  readonly rawDescription: string;
  readonly cleanedDescription: string;
  readonly canonicalMerchant: string;
  readonly parentBucket: string | null;
  readonly subcategory: string | null;
  readonly rewardCategory: string | null;
  readonly confidence: number;
  readonly matchStrategy: MatchStrategy;
  readonly paymentRail: PaymentRail | null;
  readonly requiresLLM: boolean;
}

const NOISE_PREFIXES: readonly RegExp[] = [
  /^(?:PURCHASE AUTHORIZED ON \d{2}\/\d{2}(?:\/\d{2,4})?\s*)/i,
  /^(?:CHECKCARD|PURCHASE|WITHDRAWAL|POS DEBIT|DEBIT CARD PURCHASE|RECURRING PAYMENT)(?:\s+\d{2}\/\d{2}(?:\/\d{2,4})?)?\s*-?\s*/i,
  /^\d{2}\/\d{2}(?:\/\d{2,4})?\s*/,
  /^(?:PAYMENT TO|DIRECT DEBIT|ACH DEBIT)\s*/i,
];

const AGGREGATOR_RAILS: readonly [PaymentRail, RegExp][] = [
  ["Toast", /^(?:TST\s*\*|TOAST\s*\*|TOAST POS\s*-\s*)/i],
  ["Square", /^(?:SQ\s*\*|SQR\s*\*|SQUARE\s*\*|SQC\s*\*)/i],
  ["PayPal", /^(?:PAYPAL\s*\*|PP\s*\*\s*)/i],
  ["Stripe", /^(?:STRIPE\s*\*|SP\s*\*)/i],
  ["Shopify", /^(?:SHOPIFY\s*\*|SP\s+)/i],
  ["Venmo", /^(?:VENMO\s*\*|VENMO PAYMENT\s*)/i],
  ["ApplePay", /^(?:APL\s*\*|APPLE\.COM\/BILL\s*)/i],
];

const TRAILING_NOISE_PATTERNS: readonly RegExp[] = [
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
  /\bSTORE\s*#?\s*\d+\b/gi,
  /\bLOC(?:ATION)?\s*#?\s*\d+\b/gi,
  /(?:^|\s)#\s*[\w\d-]+\b/g,
  /\bT-\d+\b/gi,
  /\.COM(?:\/[A-Z0-9]+)?/gi,
  /\s+\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/gi,
  /\s+\b(?:CAMBRIDGE|BOSTON|SOMERVILLE|SEATTLE|SAN JOSE|NEW YORK|SAN FRANCISCO)\b(?=\s+[A-Z]{2}\b|\s*$)/gi,
  /\s+\b[A-Z]{2}\b$/g,
  /\s+\b\d{4,}\b$/g,
];

export const DEFAULT_CANONICAL_RULES: Readonly<Record<string, CategoryRule>> = {
  "WHOLE FOODS": {
    canonicalName: "Whole Foods Market",
    parentBucket: "Fixed Costs",
    subcategory: "Groceries",
    rewardMultiplierCategory: "Groceries",
  },
  WHOLEFDS: {
    canonicalName: "Whole Foods Market",
    parentBucket: "Fixed Costs",
    subcategory: "Groceries",
    rewardMultiplierCategory: "Groceries",
  },
  "TRADER JOE": {
    canonicalName: "Trader Joe's",
    parentBucket: "Fixed Costs",
    subcategory: "Groceries",
    rewardMultiplierCategory: "Groceries",
  },
  "TRDR JOE": {
    canonicalName: "Trader Joe's",
    parentBucket: "Fixed Costs",
    subcategory: "Groceries",
    rewardMultiplierCategory: "Groceries",
  },
  "COSTCO WHS": {
    canonicalName: "Costco Wholesale",
    parentBucket: "Fixed Costs",
    subcategory: "Groceries",
    rewardMultiplierCategory: "Wholesale",
  },
  "BOSTON MARKET": {
    canonicalName: "Boston Market",
    parentBucket: "Guilt-Free",
    subcategory: "Dining",
    rewardMultiplierCategory: "Dining",
  },
  "BLUE BOTTLE": {
    canonicalName: "Blue Bottle Coffee",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  "TATTE BAKERY & CAFE": {
    canonicalName: "Tatte Bakery & Cafe",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  "TATTE BAKERY": {
    canonicalName: "Tatte Bakery & Cafe",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  STARBUCKS: {
    canonicalName: "Starbucks",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  BERRYLINE: {
    canonicalName: "Berryline",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  SWEETGREEN: {
    canonicalName: "Sweetgreen",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  CHIPOTLE: {
    canonicalName: "Chipotle Mexican Grill",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  "SHAKE SHACK": {
    canonicalName: "Shake Shack",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  MCDONALDS: {
    canonicalName: "McDonald's",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  "MCDONALD'S": {
    canonicalName: "McDonald's",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  NETFLIX: {
    canonicalName: "Netflix",
    parentBucket: "Fixed Costs",
    subcategory: "Subscriptions",
    rewardMultiplierCategory: "Entertainment",
  },
  SPOTIFY: {
    canonicalName: "Spotify",
    parentBucket: "Fixed Costs",
    subcategory: "Subscriptions",
    rewardMultiplierCategory: "Entertainment",
  },
  "AMAZON PRIME": {
    canonicalName: "Amazon Prime",
    parentBucket: "Fixed Costs",
    subcategory: "Subscriptions",
    rewardMultiplierCategory: "Other",
  },
  AMAZON: {
    canonicalName: "Amazon",
    parentBucket: "Guilt-Free",
    subcategory: "Shopping",
    rewardMultiplierCategory: "Other",
  },
  "AMZN MKTP": {
    canonicalName: "Amazon Marketplace",
    parentBucket: "Guilt-Free",
    subcategory: "Shopping",
    rewardMultiplierCategory: "Other",
  },
  "UBER TRIP": {
    canonicalName: "Uber",
    parentBucket: "Fixed Costs",
    subcategory: "Transit",
    rewardMultiplierCategory: "Travel",
  },
  "UBER EATS": {
    canonicalName: "Uber Eats",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  DOORDASH: {
    canonicalName: "DoorDash",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  GRUBHUB: {
    canonicalName: "Grubhub",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  CAVA: {
    canonicalName: "Cava",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  "PANDA EXPRESS": {
    canonicalName: "Panda Express",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  "INSOMNIA COOKIES": {
    canonicalName: "Insomnia Cookies",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  "SALT & STRAW": {
    canonicalName: "Salt & Straw",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  "SALT AND STRAW": {
    canonicalName: "Salt & Straw",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  AMORINO: {
    canonicalName: "Amorino",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  "FLOUR BAKERY": {
    canonicalName: "Flour Bakery",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  "SUBWAY RESTAURANT": {
    canonicalName: "Subway",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  "SUBWAY SANDWICHES": {
    canonicalName: "Subway",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  "SUBWAY SANDWICH": {
    canonicalName: "Subway",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  LYFT: {
    canonicalName: "Lyft",
    parentBucket: "Fixed Costs",
    subcategory: "Transit",
    rewardMultiplierCategory: "Travel",
  },
  CHEVRON: {
    canonicalName: "Chevron",
    parentBucket: "Fixed Costs",
    subcategory: "Transit",
    rewardMultiplierCategory: "Gas",
  },
  "SHELL OIL": {
    canonicalName: "Shell",
    parentBucket: "Fixed Costs",
    subcategory: "Transit",
    rewardMultiplierCategory: "Gas",
  },
  EXXONMOBIL: {
    canonicalName: "ExxonMobil",
    parentBucket: "Fixed Costs",
    subcategory: "Transit",
    rewardMultiplierCategory: "Gas",
  },
  "DELTA AIR": {
    canonicalName: "Delta Air Lines",
    parentBucket: "Savings",
    subcategory: "Travel Fund",
    rewardMultiplierCategory: "Travel",
  },
  "UNITED AIRLINES": {
    canonicalName: "United Airlines",
    parentBucket: "Savings",
    subcategory: "Travel Fund",
    rewardMultiplierCategory: "Travel",
  },
  CONEDISON: {
    canonicalName: "ConEdison",
    parentBucket: "Fixed Costs",
    subcategory: "Utilities",
    rewardMultiplierCategory: "Other",
  },
  "BLOC SHOP": {
    canonicalName: "Bloc Shop",
    parentBucket: "Fixed Costs",
    subcategory: "Fitness",
    rewardMultiplierCategory: "Other",
  },
  "CENTRAL ROCK GYM": {
    canonicalName: "Central Rock Gym",
    parentBucket: "Fixed Costs",
    subcategory: "Fitness",
    rewardMultiplierCategory: "Other",
  },
  CRG: {
    canonicalName: "Central Rock Gym",
    parentBucket: "Fixed Costs",
    subcategory: "Fitness",
    rewardMultiplierCategory: "Other",
  },
  THERAPY: {
    canonicalName: "Therapy",
    parentBucket: "Fixed Costs",
    subcategory: "Healthcare",
    rewardMultiplierCategory: "Other",
  },
};

export const CONTEXTUAL_REGEX_RULES: readonly {
  pattern: RegExp;
  canonicalName: string;
  parentBucket: ParentBucket;
  subcategory: Subcategory;
  rewardMultiplierCategory: string;
}[] = [
  {
    pattern:
      /\b(?:MTA|MBTA|BART|WMATA|SEPTA|OMNY|METROCARD|CLIPPER|VENTRA|SMARTRIP|CHARLIE\s*CARD|COMMUTER RAIL|CALTRAIN|AMTRAK|PUBLIC TRANSIT|PANYNJ|(?:METRO|PATH|SUBWAY|BUS|TRAIN)\s+(?:FARE|PASS|TICKET|TRANSIT|RIDE|STATION|TRAIN|RAIL)|(?:NYC|NYCT|MTA|MBTA)\s+(?:SUBWAY|TRANSIT))\b/i,
    canonicalName: "Public Transit",
    parentBucket: "Fixed Costs",
    subcategory: "Transit",
    rewardMultiplierCategory: "Travel",
  },
  {
    pattern:
      /\b(?:TAKEOUT|FAST FOOD|FOOD DELIVERY|MCDONALD'?S|BURGER KING|WENDY'?S|TACO BELL|DOMINO'?S|SUBWAY\s+(?:#?\d+|SANDWICH(?:ES)?|RESTAURANT|STORE|EATS))\b/i,
    canonicalName: "Takeout & Delivery",
    parentBucket: "Guilt-Free",
    subcategory: "Takeout",
    rewardMultiplierCategory: "Dining",
  },
  {
    pattern: /\b(?:PIZZA|PIZZERIA|TAQUERIA|BURGER|SUSHI|RESTAURANT|BISTRO|GRILL|DINER|RAMEN)\b/i,
    canonicalName: "Dining & Restaurant",
    parentBucket: "Guilt-Free",
    subcategory: "Dining",
    rewardMultiplierCategory: "Dining",
  },
  {
    pattern: /\b(?:MARKET|GROCERY|PRODUCE|BODEGA|SUPERMARKET)\b/i,
    canonicalName: "Grocery Store",
    parentBucket: "Fixed Costs",
    subcategory: "Groceries",
    rewardMultiplierCategory: "Groceries",
  },
  {
    pattern:
      /\b(?:CAFE|COFFEE|ROASTERY|BAKERY|ESPRESSO|ICE CREAM|FROZEN YOGURT|BOBA|BUBBLE TEA|MILK TEA|TEA HOUSE|TEA ROOM|TEA SHOP)\b/i,
    canonicalName: "Cafe & Bakery",
    parentBucket: "Guilt-Free",
    subcategory: "Coffee & Snacks",
    rewardMultiplierCategory: "Dining",
  },
  {
    pattern: /\b(?:PHARMACY|DRUGS|CVS|WALGREENS)\b/i,
    canonicalName: "Pharmacy",
    parentBucket: "Fixed Costs",
    subcategory: "Groceries",
    rewardMultiplierCategory: "Drugstores",
  },
  {
    pattern: /\b(?:PARKING|PARKMOBILE|METER|GARAGE)\b/i,
    canonicalName: "Parking",
    parentBucket: "Fixed Costs",
    subcategory: "Transit",
    rewardMultiplierCategory: "Travel",
  },
  {
    pattern: /\b(?:CLIMBING|BOULDERING|FITNESS|YOGA|PILATES|CROSSFIT)\b/i,
    canonicalName: "Gym & Fitness",
    parentBucket: "Fixed Costs",
    subcategory: "Fitness",
    rewardMultiplierCategory: "Other",
  },
  {
    pattern: /\b(?:THERAPY|PSYCHOTHERAPY|COUNSELING|PSYCHIATRY)\b/i,
    canonicalName: "Mental Therapy",
    parentBucket: "Fixed Costs",
    subcategory: "Healthcare",
    rewardMultiplierCategory: "Other",
  },
];

/**
 * Converts a string to Title Case while preserving apostrophes and hyphens.
 */
export function toTitleCase(value: string): string {
  if (!value) return "";

  return value
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (!word) return "";
      if (word.includes("-")) {
        return word
          .split("-")
          .map((sub) => (sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : ""))
          .join("-");
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitizes a raw transaction descriptor string by removing bank noise,
 * extracting the payment rail, and excising trailing store or location tokens.
 */
export function cleanRawDescriptor(rawDescription: string): {
  cleaned: string;
  rail: PaymentRail | null;
} {
  let text = rawDescription.trim();

  for (const prefixPattern of NOISE_PREFIXES) {
    text = text.replace(prefixPattern, "");
  }

  let rail: PaymentRail | null = null;
  for (const [railName, railPattern] of AGGREGATOR_RAILS) {
    if (railPattern.test(text)) {
      rail = railName;
      text = text.replace(railPattern, "");
      break;
    }
  }

  // Preserve Subway restaurant store-number evidence before trailing noise stripping
  text = text.replace(/\bSUBWAY\s+(?:STORE\s*#?|#)\s*\d+\b/gi, "SUBWAY RESTAURANT");
  text = text.replace(/\bSUBWAY\s+\d{3,}\b/gi, "SUBWAY RESTAURANT");

  for (const trailingPattern of TRAILING_NOISE_PATTERNS) {
    text = text.replace(trailingPattern, " ");
  }

  text = text.replace(/[*#_/\\]+/g, " ");
  text = text.replace(/\s+-\s+/g, " ");
  text = text.replace(/\s+/g, " ").trim().toUpperCase();

  return { cleaned: text, rail };
}

/**
 * Deterministically normalizes a transaction descriptor through greedy exact matching,
 * regex heuristics, and payment rail defaults before flagging for LLM fallback.
 */
export function normalizeMerchant(
  rawDescription: string,
  rulesRecord: Record<string, CategoryRule> = DEFAULT_CANONICAL_RULES,
): NormalizedTransaction {
  const { cleaned, rail } = cleanRawDescriptor(rawDescription);

  const sortedTokens = Object.keys(rulesRecord).sort((a, b) => b.length - a.length);

  for (const token of sortedTokens) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    if (pattern.test(cleaned)) {
      const rule = rulesRecord[token];
      return {
        rawDescription,
        cleanedDescription: cleaned,
        canonicalMerchant: rule.canonicalName,
        parentBucket: rule.parentBucket,
        subcategory: rule.subcategory,
        rewardCategory: rule.rewardMultiplierCategory ?? null,
        confidence: 0.98,
        matchStrategy: "exact_rule",
        paymentRail: rail,
        requiresLLM: false,
      };
    }
  }

  for (const rule of CONTEXTUAL_REGEX_RULES) {
    if (rule.pattern.test(cleaned)) {
      return {
        rawDescription,
        cleanedDescription: cleaned,
        canonicalMerchant: toTitleCase(cleaned),
        parentBucket: rule.parentBucket,
        subcategory: rule.subcategory,
        rewardCategory: rule.rewardMultiplierCategory,
        confidence: 0.88,
        matchStrategy: "regex_heuristic",
        paymentRail: rail,
        requiresLLM: false,
      };
    }
  }

  if (rail === "Toast") {
    return {
      rawDescription,
      cleanedDescription: cleaned,
      canonicalMerchant: toTitleCase(cleaned) || "Toast Merchant",
      parentBucket: "Guilt-Free",
      subcategory: "Dining",
      rewardCategory: "Dining",
      confidence: 0.82,
      matchStrategy: "aggregator_heuristic",
      paymentRail: rail,
      requiresLLM: false,
    };
  }

  return {
    rawDescription,
    cleanedDescription: cleaned,
    canonicalMerchant: toTitleCase(cleaned) || "Unknown Merchant",
    parentBucket: null,
    subcategory: null,
    rewardCategory: null,
    confidence: cleaned ? 0.2 : 0.0,
    matchStrategy: "unresolved",
    paymentRail: rail,
    requiresLLM: true,
  };
}
