-- Computes USD expense net spend and count for a specified calendar month (YYYY-MM).
SELECT
    COALESCE(SUM(net_spend), 0.0) AS month_net_spend,
    COUNT(*) AS month_count
FROM transactions
WHERE date >= ?1 || '-01'
  AND date <= ?1 || '-31'
  AND parent_bucket != 'Income'
  AND currency = 'USD';
