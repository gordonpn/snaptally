-- Counts transactions matching optional search and parent_bucket filters.
SELECT COUNT(*) AS total
FROM transactions
WHERE (?1 IS NULL OR merchant LIKE '%' || ?1 || '%' OR card LIKE '%' || ?1 || '%')
  AND (?2 IS NULL OR parent_bucket = ?2);
