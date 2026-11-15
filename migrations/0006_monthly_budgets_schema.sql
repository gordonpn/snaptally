-- Monthly targets are USD reporting amounts for the current single-user budget.
-- Keep demo values in the opt-in local seed, not in production migrations.
CREATE TABLE monthly_budgets (
    id TEXT PRIMARY KEY NOT NULL,
    year_month TEXT NOT NULL CHECK (
        year_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
        AND substr(year_month, 6, 2) BETWEEN '01' AND '12'
    ),
    parent_bucket TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    target_amount REAL NOT NULL CHECK (
        typeof(target_amount) IN ('integer', 'real')
        AND target_amount >= 0.0
        AND target_amount <= 1.7976931348623157e308
    ),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (year_month, parent_bucket, subcategory)
);
