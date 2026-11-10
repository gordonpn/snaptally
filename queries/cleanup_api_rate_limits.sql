-- Indexed, bounded cleanup keeps expired clients from accumulating indefinitely.
DELETE FROM api_rate_limits
WHERE key IN (
    SELECT key FROM api_rate_limits
    WHERE window_start < ?1
    ORDER BY window_start
    LIMIT 100
);
