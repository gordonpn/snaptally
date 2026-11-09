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

export type BackfillCommand = "plan" | "apply" | "resume" | "verify";

export type BackfillTarget = "local" | "remote" | "memory";

export interface BackfillOptions {
  command?: BackfillCommand;
  userId: string;
  defaultCard: string;
  dryRun: boolean;
  local: boolean;
  remote: boolean;
  dir?: string;
  file?: string;
  planFile?: string;
  runId?: string;
  yes?: boolean;
  artifactsDir?: string;
  skipPreflightBackup?: boolean;
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

export interface SourceFileManifest {
  filename: string;
  sha256: string;
  totalRows: number;
  validTransactions: number;
  skippedRows: number;
}

export interface BackfillManifest {
  manifestVersion: string;
  manifestHash: string;
  sourceDir: string;
  userId: string;
  defaultCard: string;
  parserVersion: string;
  files: SourceFileManifest[];
  totalValidTransactions: number;
  totalSkippedRows: number;
  createdAt: string;
}

export interface ExistingDbTransaction {
  id: string;
  user_id: string;
  date: string;
  card: string;
  parent_bucket: string;
  subcategory: string;
  merchant: string;
  gross_amount: number;
  reimbursement: number;
  currency: string;
}

export type RowClassificationType = "already_present" | "missing" | "conflicting" | "extra";

export interface ConflictDetail {
  id: string;
  sourceFile?: string;
  sourceRow?: number;
  field: string;
  sourceValue: string | number;
  dbValue: string | number;
  isRowShiftRisk?: boolean;
}

export interface ClassificationReport {
  manifestHash: string;
  target: BackfillTarget;
  userId: string;
  card: string;
  counts: {
    totalSource: number;
    totalDb: number;
    alreadyPresent: number;
    missing: number;
    conflicting: number;
    extra: number;
  };
  missingTransactions: BackfillTransaction[];
  conflicts: ConflictDetail[];
  sampleMissingIds: string[];
  sampleAlreadyPresentIds: string[];
  sampleExtraIds: string[];
  dateRange: { min: string | null; max: string | null };
  currencyBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
}

export interface RunArtifactVerification {
  preCount: number;
  postCount: number;
  expectedPostCount: number;
  passed: boolean;
}

export interface RunArtifact {
  runId: string;
  command: BackfillCommand;
  target: BackfillTarget;
  userId: string;
  defaultCard: string;
  manifestHash: string;
  manifest: BackfillManifest;
  parserVersion: string;
  counts: {
    considered: number;
    alreadyPresent: number;
    missing: number;
    conflicting: number;
    extra: number;
    written: number;
    skipped: number;
    failed: number;
  };
  sampleMissingIds: string[];
  sampleAlreadyPresentIds: string[];
  sampleExtraIds: string[];
  conflicts: ConflictDetail[];
  verification: RunArtifactVerification;
  exitCode: number;
  createdAt: string;
  completedAt: string;
  error?: string;
}

export interface CheckpointState {
  runId: string;
  manifestHash: string;
  target: BackfillTarget;
  userId: string;
  defaultCard: string;
  totalBatches: number;
  completedBatches: number[];
  writtenCount: number;
  lastUpdated: string;
}

export const BACKFILL_EXIT_CODES = {
  SUCCESS: 0,
  EXECUTION_ERROR: 1,
  APPROVAL_REQUIRED: 2,
  VERIFICATION_FAILURE: 3,
} as const;

export type BackfillExitCode = (typeof BACKFILL_EXIT_CODES)[keyof typeof BACKFILL_EXIT_CODES];
