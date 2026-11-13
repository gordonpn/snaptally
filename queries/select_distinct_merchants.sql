-- POST canonicalization only; autocomplete uses select_frequent_merchants.sql.
-- Bound ingestion canonicalization to the 200 most recently inserted transactions.
-- Limit before grouping so repeated merchants cannot expand historical reads.
SELECT merchant
FROM (
    SELECT merchant, created_at, rowid AS transaction_rowid
    FROM transactions
    ORDER BY rowid DESC
    LIMIT 200
)
GROUP BY merchant
ORDER BY MAX(created_at) DESC, MAX(transaction_rowid) DESC;
