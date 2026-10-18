import type { ParentBucket, Subcategory } from "../../src/config/intake.ts";

export interface BackfillTransaction {
  id: string;
  userId: string;
  date: string;
  card: string;
  parentBucket: ParentBucket;
  subcategory: Subcategory;
  merchant: string;
  grossAmount: number;
  reimbursement: number;
  currency: "USD" | "CAD";
  sourceFile: string;
  sourceRow: number;
}

export interface BackfillOptions {
  userId: string;
  defaultCard: string;
  dryRun: boolean;
  local: boolean;
  remote: boolean;
  dir?: string;
  file?: string;
}

export interface SheetAdapter {
  name: string;
  match: (filename: string) => boolean;
  parse: (rows: string[][], filename: string, options: BackfillOptions) => BackfillTransaction[];
}

export interface SheetSummary {
  file: string;
  totalRows: number;
  validTransactions: number;
  skippedRows: number;
  usdCount: number;
  cadCount: number;
}

export interface BackfillSummary {
  sheets: SheetSummary[];
  totalValid: number;
  totalSkipped: number;
  totalUsd: number;
  totalCad: number;
  categoryBreakdown: Record<string, number>;
}
