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
    created_at
FROM transactions
ORDER BY date DESC, created_at DESC, rowid DESC
LIMIT ?;
