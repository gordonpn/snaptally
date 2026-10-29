-- Selects paginated transactions with optional search and parent_bucket filtering.
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
WHERE (?1 IS NULL OR merchant LIKE '%' || ?1 || '%' OR card LIKE '%' || ?1 || '%')
  AND (?2 IS NULL OR parent_bucket = ?2)
ORDER BY date DESC, created_at DESC, rowid DESC
LIMIT ?3 OFFSET ?4;
