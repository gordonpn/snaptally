-- Aggregates USD transaction net spend and counts by stored category pair for a calendar month (YYYY-MM).
-- Downstream analysis maps Savings -> Investments and separates Income from unrecognized categories.
SELECT
    parent_bucket,
    subcategory,
    COALESCE(SUM(net_spend), 0.0) AS net_spend,
    COUNT(*) AS transaction_count
FROM transactions
WHERE date >= ?1 || '-01'
  AND date <= ?1 || '-31'
  AND currency = 'USD'
GROUP BY parent_bucket, subcategory
ORDER BY parent_bucket ASC, subcategory ASC;
