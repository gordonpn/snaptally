-- Bound table cardinality under distributed probing. Existing keys still increment.
INSERT INTO api_rate_limits (key, window_start, request_count)
SELECT ?1, ?2, 1
WHERE (SELECT COUNT(*) FROM api_rate_limits) < 10000
   OR EXISTS (SELECT 1 FROM api_rate_limits WHERE key = ?1)
ON CONFLICT(key) DO UPDATE SET
    request_count = CASE
        WHEN api_rate_limits.window_start = excluded.window_start
        THEN MIN(api_rate_limits.request_count + 1, 1000000)
        ELSE 1
    END,
    window_start = excluded.window_start
RETURNING request_count;
