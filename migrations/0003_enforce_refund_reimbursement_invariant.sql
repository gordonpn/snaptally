-- Migration 0003: Enforce database invariant that refunds (negative gross_amount) must have zero reimbursement,
-- and positive expenses cannot have reimbursement exceeding gross_amount.
CREATE TRIGGER IF NOT EXISTS validate_refund_reimbursement_insert
BEFORE INSERT ON transactions
WHEN (NEW.gross_amount < 0 AND COALESCE(NEW.reimbursement, 0.0) != 0.0)
  OR (NEW.gross_amount > 0 AND COALESCE(NEW.reimbursement, 0.0) > NEW.gross_amount)
BEGIN
    SELECT RAISE(ABORT, 'Invalid transaction reimbursement amount');
END;

CREATE TRIGGER IF NOT EXISTS validate_refund_reimbursement_update
BEFORE UPDATE OF gross_amount, reimbursement ON transactions
WHEN (NEW.gross_amount < 0 AND COALESCE(NEW.reimbursement, 0.0) != 0.0)
  OR (NEW.gross_amount > 0 AND COALESCE(NEW.reimbursement, 0.0) > NEW.gross_amount)
BEGIN
    SELECT RAISE(ABORT, 'Invalid transaction reimbursement amount');
END;
