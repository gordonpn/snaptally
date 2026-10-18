-- Migration 0003: Remediate legacy invalid reimbursement records and enforce database
-- invariants that refunds (negative gross_amount) must have zero reimbursement,
-- and positive expenses must have non-negative reimbursement not exceeding gross_amount.

-- 1. Remediate legacy rows where reimbursement exceeds gross_amount for positive expenses
UPDATE transactions
SET reimbursement = gross_amount
WHERE gross_amount > 0 AND reimbursement > gross_amount;

-- 2. Remediate legacy rows where reimbursement is non-zero for negative refunds/credits
UPDATE transactions
SET reimbursement = 0.0
WHERE gross_amount < 0 AND COALESCE(reimbursement, 0.0) != 0.0;

-- 3. Remediate legacy rows where reimbursement is negative
UPDATE transactions
SET reimbursement = 0.0
WHERE reimbursement < 0.0;

CREATE TRIGGER IF NOT EXISTS validate_refund_reimbursement_insert
BEFORE INSERT ON transactions
WHEN (NEW.gross_amount < 0 AND COALESCE(NEW.reimbursement, 0.0) != 0.0)
  OR (NEW.gross_amount > 0 AND (COALESCE(NEW.reimbursement, 0.0) < 0.0 OR COALESCE(NEW.reimbursement, 0.0) > NEW.gross_amount))
BEGIN
    SELECT RAISE(ABORT, 'Invalid transaction reimbursement amount');
END;

CREATE TRIGGER IF NOT EXISTS validate_refund_reimbursement_update
BEFORE UPDATE OF gross_amount, reimbursement ON transactions
WHEN (NEW.gross_amount < 0 AND COALESCE(NEW.reimbursement, 0.0) != 0.0)
  OR (NEW.gross_amount > 0 AND (COALESCE(NEW.reimbursement, 0.0) < 0.0 OR COALESCE(NEW.reimbursement, 0.0) > NEW.gross_amount))
BEGIN
    SELECT RAISE(ABORT, 'Invalid transaction reimbursement amount');
END;
