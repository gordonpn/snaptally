-- Migration 0003: Enforce database invariant that refunds (negative gross_amount) must have zero reimbursement.
CREATE TRIGGER IF NOT EXISTS validate_refund_reimbursement_insert
BEFORE INSERT ON transactions
WHEN NEW.gross_amount < 0 AND COALESCE(NEW.reimbursement, 0.0) != 0.0
BEGIN
    SELECT RAISE(ABORT, 'Refund transactions cannot have a reimbursement');
END;

CREATE TRIGGER IF NOT EXISTS validate_refund_reimbursement_update
BEFORE UPDATE OF gross_amount, reimbursement ON transactions
WHEN NEW.gross_amount < 0 AND COALESCE(NEW.reimbursement, 0.0) != 0.0
BEGIN
    SELECT RAISE(ABORT, 'Refund transactions cannot have a reimbursement');
END;
