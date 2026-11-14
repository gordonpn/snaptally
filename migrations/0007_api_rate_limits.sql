-- Short-lived fixed-window counters. No raw IP addresses or tokens are retained.
CREATE TABLE api_rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count > 0)
);
CREATE INDEX idx_api_rate_limits_window ON api_rate_limits(window_start);
