-- Selects distinct merchants ordered by frequency descending.
-- MAX(created_at) and MAX(rowid) break frequency ties deterministically using insertion order.
SELECT merchant
FROM transactions
GROUP BY merchant
ORDER BY COUNT(*) DESC, MAX(created_at) DESC, MAX(rowid) DESC
LIMIT ?;
