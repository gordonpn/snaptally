-- Computes total net spend and transaction count for a specified calendar month (YYYY-MM).
SELECT
    COALESCE(SUM(net_spend), 0.0) AS month_net_spend,
    COUNT(*) AS month_count
FROM transactions
WHERE strftime('%Y-%m', date) = ?
  AND currency = 'USD';
