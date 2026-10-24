import { isValidDate } from "../../src/utils/date.ts";
import { normalizeMerchant } from "../../src/utils/merchant-normalizer.ts";
import { generateDeterministicId } from "./idempotency.ts";
import type { BackfillTransaction, SheetAdapter } from "./types.ts";

/**
 * Cleans monetary string into finite number, returning null for empty, zero, or invalid values.
 */
export function cleanAmount(val: string | undefined): number | null {
  if (!val) return null;
  let cleaned = val.trim();
  if (!cleaned) return null;

  // Handle accounting parentheses for negative values e.g. (7.00) -> -7.00
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = `-${cleaned.slice(1, -1).trim()}`;
  }

  if (!/^(?:[+-]?\$?|\$[+-]?)(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(cleaned)) {
    return null;
  }
  const amount = Math.round(Number(cleaned.replace(/[$,]/g, "")) * 100) / 100;
  return Number.isFinite(amount) && amount !== 0 ? amount : null;
}

/**
 * Validates ISO date string YYYY-MM-DD.
 */
export function cleanDate(val: string | undefined): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  return isValidDate(trimmed) ? trimmed : null;
}

function createTransaction(
  date: string,
  card: string,
  parentBucket: BackfillTransaction["parentBucket"],
  subcategory: BackfillTransaction["subcategory"],
  merchant: string,
  grossAmount: number,
  currency: "USD" | "CAD",
  sourceFile: string,
  sourceRow: number,
  userId: string,
): BackfillTransaction {
  const hashKey = `${userId}|${sourceFile}|${sourceRow}|${date}|${grossAmount.toFixed(2)}|${currency}`;
  const id = generateDeterministicId(hashKey);

  return {
    id,
    userId,
    date,
    card,
    parentBucket,
    subcategory,
    merchant,
    grossAmount,
    reimbursement: 0.0,
    currency,
    sourceFile,
    sourceRow,
  };
}

export const bikeshareAdapter: SheetAdapter = {
  name: "Bikeshare",
  match: (file) => /Budgeting - Bikeshare\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Fixed Costs",
          "Transit",
          "Bluebikes",
          grossAmount,
          "USD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const bostonFoodAdapter: SheetAdapter = {
  name: "Boston Food Expenses",
  match: (file) => /Budgeting - Boston food expenses\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      const rawMerchant = (row[2] || "").trim() || "Food";
      const normalized = normalizeMerchant(rawMerchant);

      let parentBucket = normalized.parentBucket ?? "Guilt-Free";
      let subcategory = normalized.subcategory ?? "Dining";
      const merchant = normalized.canonicalMerchant || rawMerchant;

      // Climbing gym cafe snacks recorded in food sheet
      if (/\b(?:BLOC SHOP|CENTRAL ROCK)\b/i.test(rawMerchant)) {
        parentBucket = "Guilt-Free";
        subcategory = "Coffee & Snacks";
      }

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          parentBucket,
          subcategory,
          merchant,
          grossAmount,
          "USD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const bostonHousingAdapter: SheetAdapter = {
  name: "Boston Housing Expenses",
  match: (file) => /Budgeting - Boston housing expenses\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      if (!date) continue;

      const cad = cleanAmount(row[3]);
      const usd = cleanAmount(row[5]);

      let grossAmount: number | null = null;
      let currency: "USD" | "CAD" = "USD";

      if (usd !== null) {
        grossAmount = usd;
        currency = "USD";
      } else if (cad !== null) {
        grossAmount = cad;
        currency = "CAD";
      }

      if (grossAmount === null) continue;

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Fixed Costs",
          "Rent",
          "Housing",
          grossAmount,
          currency,
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const canadaFoodAdapter: SheetAdapter = {
  name: "Canada Food Expenses",
  match: (file) => /Budgeting - Canada food expenses\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      const rawMerchant = (row[2] || "").trim() || "Food";
      const normalized = normalizeMerchant(rawMerchant);

      let parentBucket = normalized.parentBucket ?? "Guilt-Free";
      let subcategory = normalized.subcategory ?? "Dining";
      const merchant = normalized.canonicalMerchant || rawMerchant;

      // Climbing gym cafe snacks recorded in food sheet
      if (/\b(?:BLOC SHOP|CENTRAL ROCK)\b/i.test(rawMerchant)) {
        parentBucket = "Guilt-Free";
        subcategory = "Coffee & Snacks";
      }

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          parentBucket,
          subcategory,
          merchant,
          grossAmount,
          "CAD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const flightExpensesAdapter: SheetAdapter = {
  name: "Flight Expenses",
  match: (file) => /Budgeting - Flight expenses\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Savings",
          "Travel Fund",
          "Airlines",
          grossAmount,
          "CAD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const hydroQcAdapter: SheetAdapter = {
  name: "Hydro QC",
  match: (file) => /Budgeting - Hydro QC\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Fixed Costs",
          "Utilities",
          "Hydro-Québec",
          grossAmount,
          "CAD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const mentalTherapyAdapter: SheetAdapter = {
  name: "Mental Therapy",
  match: (file) => /Budgeting - Mental therapy\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Fixed Costs",
          "Healthcare",
          "Therapy",
          grossAmount,
          "USD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const montrealGasAdapter: SheetAdapter = {
  name: "Montreal Gas Expenses",
  match: (file) => /Budgeting - Montreal gas expenses\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      let date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      // Remediate isolated 2014-11-02 typo in sheet surrounded by 2024 entries
      if (date === "2014-11-02") {
        date = "2024-11-02";
      }

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Fixed Costs",
          "Transit",
          "Gas Station",
          grossAmount,
          "CAD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const rideHailAdapter: SheetAdapter = {
  name: "Ride-hail",
  match: (file) => /Budgeting - Ride-hail\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      if (!date) continue;

      const usd = cleanAmount(row[1]);
      const cad = cleanAmount(row[2]);

      let grossAmount: number | null = null;
      let currency: "USD" | "CAD" = "USD";

      if (usd !== null) {
        grossAmount = usd;
        currency = "USD";
      } else if (cad !== null) {
        grossAmount = cad;
        currency = "CAD";
      }

      if (grossAmount === null) continue;

      const rawService = (row[3] || "").trim() || "Ride-hail";

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Fixed Costs",
          "Transit",
          rawService,
          grossAmount,
          currency,
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const salaryAdapter: SheetAdapter = {
  name: "Salary",
  match: (file) => /Budgeting - Salary\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Income",
          "Salary",
          "Employer",
          grossAmount,
          "USD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const rsuAdapter: SheetAdapter = {
  name: "RSU Income",
  match: (file) => /Budgeting - RSU-related income\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      const currency: "USD" | "CAD" = row[2]?.trim().toUpperCase() === "CAD" ? "CAD" : "USD";

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Income",
          "Salary",
          "Employer",
          grossAmount,
          currency,
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const stuffAdapter: SheetAdapter = {
  name: "Stuff",
  match: (file) => /Budgeting - Stuff\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      if (!date) continue;

      const usd = cleanAmount(row[1]);
      const cad = cleanAmount(row[2]);

      let grossAmount: number | null = null;
      let currency: "USD" | "CAD" = "USD";

      if (usd !== null) {
        grossAmount = usd;
        currency = "USD";
      } else if (cad !== null) {
        grossAmount = cad;
        currency = "CAD";
      }

      if (grossAmount === null) continue;

      const rawMerchant = (row[4] || "").trim() || "Miscellaneous";
      const description = (row[5] || "").trim();
      const combined = `${rawMerchant} ${description}`.trim();
      const normalized = normalizeMerchant(rawMerchant);

      let parentBucket = normalized.parentBucket ?? "Guilt-Free";
      let subcategory = normalized.subcategory ?? "Shopping";
      let merchant = normalized.canonicalMerchant || rawMerchant;

      // Contextual overrides based on merchant + description in Stuff sheet
      if (rawMerchant.toLowerCase() === "gas" || description.toLowerCase() === "gas") {
        parentBucket = "Fixed Costs";
        subcategory = "Transit";
        if (rawMerchant.toLowerCase() === "gas") {
          merchant = description
            ? description.toLowerCase().includes("bj")
              ? "BJ's Gas"
              : description
            : "Gas Station";
        } else {
          merchant = rawMerchant.toLowerCase().includes("gas") ? rawMerchant : `${rawMerchant} Gas`;
        }
      } else if (
        /\b(?:CLIMB|BOULDER|GYM|FITNESS|PICKLE)\b/i.test(combined) ||
        normalized.subcategory === "Fitness"
      ) {
        parentBucket = "Fixed Costs";
        subcategory = "Fitness";
      } else if (/\b(?:INSURANCE|ASSURANT)\b/i.test(combined)) {
        parentBucket = "Fixed Costs";
        subcategory = "Utilities";
      } else if (/\b(?:RETINAL|EYE GLASSES|OPTOMETR|EXAM|VISION)\b/i.test(combined)) {
        parentBucket = "Fixed Costs";
        subcategory = "Healthcare";
      } else if (
        /\b(?:AMC|CINEMA|THEATRE|THEATER|CIRQUE|SIX FLAGS|AQUARIUM|MUSEUM|CHICAGO BULLS)\b/i.test(
          combined,
        )
      ) {
        parentBucket = "Guilt-Free";
        subcategory = "Entertainment";
      } else if (/\b(?:CRUNCHYROLL|RING|REAL-DEBRID|MEDIUM|DEEPSEEK|TSN)\b/i.test(combined)) {
        parentBucket = "Fixed Costs";
        subcategory = "Subscriptions";
      } else if (
        /\b(?:PARKING|MBTA|VENTRA|CLIPPER|STM|EZPASS|EZ-PASS|TRANSIT|SUBWAY)\b/i.test(combined)
      ) {
        parentBucket = "Fixed Costs";
        subcategory = "Transit";
      } else if (/\b(?:DELTA|FLIGHT|AIRLINE|LUGGAGE)\b/i.test(combined)) {
        parentBucket = "Savings";
        subcategory = "Travel Fund";
      }

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          parentBucket,
          subcategory,
          merchant,
          grossAmount,
          currency,
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const utilitiesAdapter: SheetAdapter = {
  name: "Utilities",
  match: (file) => /Budgeting - Utilities\.csv$/i.test(file),
  parse: (rows, filename, options) => {
    const transactions: BackfillTransaction[] = [];
    const dataRows = rows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const sourceRow = i + 2;
      const date = cleanDate(row[0]);
      const grossAmount = cleanAmount(row[1]);
      if (!date || grossAmount === null) continue;

      const rawMerchant = (row[2] || "").trim() || "Utility";

      transactions.push(
        createTransaction(
          date,
          options.defaultCard,
          "Fixed Costs",
          "Utilities",
          rawMerchant,
          grossAmount,
          "USD",
          filename,
          sourceRow,
          options.userId,
        ),
      );
    }
    return transactions;
  },
};

export const ALL_ADAPTERS: readonly SheetAdapter[] = [
  bikeshareAdapter,
  bostonFoodAdapter,
  bostonHousingAdapter,
  canadaFoodAdapter,
  flightExpensesAdapter,
  hydroQcAdapter,
  mentalTherapyAdapter,
  montrealGasAdapter,
  rideHailAdapter,
  rsuAdapter,
  salaryAdapter,
  stuffAdapter,
  utilitiesAdapter,
];
