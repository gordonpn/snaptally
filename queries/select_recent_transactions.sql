-- Selects recent transactions ordered by calendar date descending.
-- created_at and rowid break date ties deterministically using insertion order.
SELECT
    id,
    date,
    card,
    parent_bucket,
    subcategory,
    merchant,
    gross_amount,
    reimbursement,
    net_spend,
    currency,
    created_at
FROM transactions
ORDER BY date DESC, created_at DESC, rowid DESC
LIMIT ?;

