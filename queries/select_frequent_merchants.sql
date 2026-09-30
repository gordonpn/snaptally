SELECT merchant
FROM transactions
GROUP BY merchant
ORDER BY COUNT(*) DESC, MAX(created_at) DESC, MAX(rowid) DESC
LIMIT ?;
