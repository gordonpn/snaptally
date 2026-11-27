-- Aggregates USD subcategory net spend and counts for a calendar month (YYYY-MM).
-- Includes Savings -> Investments rows when querying the Investments analysis bucket.
SELECT
    parent_bucket,
    subcategory,
    COALESCE(SUM(net_spend), 0.0) AS net_spend,
    COUNT(*) AS transaction_count
FROM transactions
WHERE date >= ?1 || '-01'
  AND date <= ?1 || '-31'
  AND currency = 'USD'
  AND (
    ?2 IS NULL
    OR parent_bucket = ?2
    OR (?2 = 'Investments' AND parent_bucket = 'Savings' AND subcategory = 'Investments')
  )
GROUP BY parent_bucket, subcategory
ORDER BY net_spend DESC, parent_bucket ASC, subcategory ASC;
