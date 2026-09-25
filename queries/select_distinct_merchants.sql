SELECT merchant
FROM transactions
GROUP BY merchant
ORDER BY MAX(created_at) DESC;
