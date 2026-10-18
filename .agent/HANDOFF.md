# Historical backfill checkpoint

Status: Complete for the accepted reduced scope. Production ingestion remains deferred.

## Objective and acceptance

Continue the existing historical CSV backfill on `feat/google-sheets-backfill`.
The user selected the reduced scope documented in [the existing pull request](https://github.com/gordonpn/snaptally/pull/100), overriding the broader [original requirements](https://github.com/gordonpn/snaptally/issues/59).
Preserve original USD/CAD amounts, all thirteen adapters, current category decisions,
and unchanged-export idempotency. Keep description storage, budget-profile seeding,
currency conversion, and production ingestion deferred.

Acceptance: synthetic tests work without private exports; invalid dates and amounts
are rejected; missing input directories fail clearly; write failures, batching,
and repeat ingestion are tested; scripts pass typechecking; project checks and OCR pass.

## Current revision and completed work

- Branch: `feat/google-sheets-backfill`; latest code revision: `dc7295a`, pushed to the existing draft pull request.
- Intake revision: `ec757cf416eb24b71ae204095984e2705afdc442`; the working tree was clean. Existing implementation was preserved.
- Eight atomic commits add synthetic fixtures, shared calendar validation, strict monetary parsing, CLI option validation, missing-directory errors, Node.js typechecking, write-path tests, and owner-only temporary SQL files.
- Malformed CSV quotes fail before any database writes. Unchanged exports remain idempotent; edited or reordered rows may create new IDs, as documented in the runbook.
- Modified paths include `.gitignore`, `Justfile`, `package.json`, `pnpm-lock.yaml`, `tsconfig.backfill.json`, `scripts/backfill.ts`, `scripts/backfill/{adapters,csv,pipeline}.ts`, `src/utils/{date,merchant-normalizer}.ts`, `functions/api/transactions.ts`, backfill tests and synthetic fixtures, `README.md`, and `docs/RUNBOOK.md`.
- Code changes are committed. This checkpoint follows in a separate documentation commit and changes no runtime behavior.

## Verification and limits

- Code revision tested: `dc7295a`, including a detached clean worktree with no private exports. The clean worktree reused installed dependencies through a symlink.
- Node v24.15.0, pnpm 10.28.1, macOS. CI uses Node 22.
- GitHub checks passed on `dc7295a`: Node 22/Linux tests and coverage, Biome, actionlint, CodeQL, preview deployment, and preview comment. CodeRabbit explicitly skipped review because the pull request is a draft; this was not treated as a code review pass.
- `just test` and `just test-coverage`: 305 passed, zero skipped. Overall line/branch/function coverage: 98.33% / 90.39% / 91.80%; CSV parser and pipeline reached 100% in each dimension.
- `just lint`, `just typecheck`, `just build`: passed. Lint retains an existing informational Biome schema-version mismatch.
- `just backfill-dry-run`: original exports still produce 1,680 valid transactions, 1,355 USD, 325 CAD, and 35 skipped rows, with no database writes.
- Failing regression tests were observed before fixes for calendar validation, amount parsing, CLI validation, missing directories, temporary-file permissions, and malformed CSV quotes.
- Nonempty Wrangler calls were intercepted. Generated SQL was executed against in-memory SQLite using the real migrations to verify batch boundaries, reruns, all persisted fields, and tenant foreign keys. Existing local D1 and production were not modified.
- OCR v1.13.1: `ocr delegate preview --from origin/main --to HEAD --format json` and `ocr delegate rule --format json` resolved the file list and rules. All 13 reviewable files were reviewed, none skipped; 20 automatically excluded test, fixture, documentation, and lock files were reviewed manually. No unresolved critical, high, or medium findings.

## Remaining work

No implementation blockers remain. The pull request stays a draft, and the original
issue remains open for deferred work. The existing pull request's verification
section records the current scope and evidence. Production ingestion and the
broader original deliverables were not performed.

## Next action

Review the existing draft pull request and its current checks with `gh pr checks 100 --repo gordonpn/snaptally` before merging. Only the user merges pull requests.
