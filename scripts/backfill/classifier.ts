import { computeContentSignature } from "./idempotency.ts";
import type {
  BackfillTarget,
  BackfillTransaction,
  ClassificationReport,
  ConflictDetail,
  ExistingDbTransaction,
} from "./types.ts";

export interface ClassifierOptions {
  manifestHash: string;
  target: BackfillTarget;
  userId: string;
  card: string;
}

/**
 * Normalizes numbers to 2 decimal places to prevent floating-point discrepancies.
 */
function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Classifies all source transactions against existing database records into four disjoint groups:
 * - already_present: ID matches and content matches.
 * - missing: transaction is absent from DB and safe to insert.
 * - conflicting: ID exists in DB but fields differ, or same content exists under a shifted ID.
 * - extra: transaction exists in DB for this scope but is absent from source.
 */
export function classifyTransactions(
  sourceTransactions: BackfillTransaction[],
  existingDbTransactions: ExistingDbTransaction[],
  options: ClassifierOptions,
): ClassificationReport {
  const dbById = new Map<string, ExistingDbTransaction>();
  const dbBySignature = new Map<string, ExistingDbTransaction[]>();

  for (const dbTx of existingDbTransactions) {
    dbById.set(dbTx.id, dbTx);
    const sig = computeContentSignature(dbTx.date, dbTx.merchant, dbTx.gross_amount, dbTx.currency);
    const list = dbBySignature.get(sig) ?? [];
    list.push(dbTx);
    dbBySignature.set(sig, list);
  }

  const seenDbIds = new Set<string>();
  const missingTransactions: BackfillTransaction[] = [];
  const conflicts: ConflictDetail[] = [];
  const sampleMissingIds: string[] = [];
  const sampleAlreadyPresentIds: string[] = [];
  let alreadyPresentCount = 0;

  const currencyBreakdown: Record<string, number> = {};
  const categoryBreakdown: Record<string, number> = {};
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const src of sourceTransactions) {
    if (!minDate || src.date < minDate) minDate = src.date;
    if (!maxDate || src.date > maxDate) maxDate = src.date;

    currencyBreakdown[src.currency] = (currencyBreakdown[src.currency] || 0) + 1;
    const catKey = `${src.parentBucket} -> ${src.subcategory}`;
    categoryBreakdown[catKey] = (categoryBreakdown[catKey] || 0) + 1;

    const existing = dbById.get(src.id);

    if (existing) {
      seenDbIds.add(src.id);

      // Check field-by-field equality
      const fieldMismatches: Array<{
        field: string;
        source: string | number;
        db: string | number;
      }> = [];

      if (src.date !== existing.date) {
        fieldMismatches.push({ field: "date", source: src.date, db: existing.date });
      }
      if (src.card !== existing.card) {
        fieldMismatches.push({ field: "card", source: src.card, db: existing.card });
      }
      if (src.parentBucket !== existing.parent_bucket) {
        fieldMismatches.push({
          field: "parent_bucket",
          source: src.parentBucket,
          db: existing.parent_bucket,
        });
      }
      if (src.subcategory !== existing.subcategory) {
        fieldMismatches.push({
          field: "subcategory",
          source: src.subcategory,
          db: existing.subcategory,
        });
      }
      if (src.merchant.trim() !== existing.merchant.trim()) {
        fieldMismatches.push({
          field: "merchant",
          source: src.merchant,
          db: existing.merchant,
        });
      }
      if (roundToTwo(src.grossAmount) !== roundToTwo(existing.gross_amount)) {
        fieldMismatches.push({
          field: "gross_amount",
          source: src.grossAmount,
          db: existing.gross_amount,
        });
      }
      if (src.currency !== existing.currency) {
        fieldMismatches.push({
          field: "currency",
          source: src.currency,
          db: existing.currency,
        });
      }

      if (fieldMismatches.length > 0) {
        for (const mismatch of fieldMismatches) {
          conflicts.push({
            id: src.id,
            sourceFile: src.sourceFile,
            sourceRow: src.sourceRow,
            field: mismatch.field,
            sourceValue: mismatch.source,
            dbValue: mismatch.db,
          });
        }
      } else {
        alreadyPresentCount++;
        if (sampleAlreadyPresentIds.length < 5) {
          sampleAlreadyPresentIds.push(src.id);
        }
      }
    } else {
      // ID not in DB; check for row-shift / duplicate signature under another ID
      const sig = computeContentSignature(src.date, src.merchant, src.grossAmount, src.currency);
      const matches = dbBySignature.get(sig);

      if (matches && matches.length > 0) {
        // Content signature matches an existing DB row under a different ID
        const matchedDbTx = matches[0];
        conflicts.push({
          id: src.id,
          sourceFile: src.sourceFile,
          sourceRow: src.sourceRow,
          field: "row_shift_duplicate",
          sourceValue: src.id,
          dbValue: matchedDbTx.id,
          isRowShiftRisk: true,
        });
      } else {
        missingTransactions.push(src);
        if (sampleMissingIds.length < 5) {
          sampleMissingIds.push(src.id);
        }
      }
    }
  }

  // Find extra rows in DB that are not in source
  const sampleExtraIds: string[] = [];
  let extraCount = 0;

  for (const dbTx of existingDbTransactions) {
    if (!seenDbIds.has(dbTx.id)) {
      extraCount++;
      if (sampleExtraIds.length < 5) {
        sampleExtraIds.push(dbTx.id);
      }
    }
  }

  return {
    manifestHash: options.manifestHash,
    target: options.target,
    userId: options.userId,
    card: options.card,
    counts: {
      totalSource: sourceTransactions.length,
      totalDb: existingDbTransactions.length,
      alreadyPresent: alreadyPresentCount,
      missing: missingTransactions.length,
      conflicting: conflicts.length,
      extra: extraCount,
    },
    missingTransactions,
    conflicts,
    sampleMissingIds,
    sampleAlreadyPresentIds,
    sampleExtraIds,
    dateRange: { min: minDate, max: maxDate },
    currencyBreakdown,
    categoryBreakdown,
  };
}
