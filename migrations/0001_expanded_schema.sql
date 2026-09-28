CREATE TABLE transactions_new (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    card TEXT NOT NULL,
    parent_bucket TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    merchant TEXT NOT NULL,
    gross_amount REAL NOT NULL,
    reimbursement REAL DEFAULT 0.0,
    net_spend REAL GENERATED ALWAYS AS (gross_amount - COALESCE(reimbursement, 0.0)) STORED,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO transactions_new (id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, created_at)
SELECT
    id,
    COALESCE(strftime('%Y-%m-%d', created_at), date('now')) AS date,
    card,
    'Variable' AS parent_bucket,
    category AS subcategory,
    merchant,
    amount AS gross_amount,
    0.0 AS reimbursement,
    created_at
FROM transactions;

DROP TABLE transactions;

ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX IF NOT EXISTS idx_transactions_date_created_at ON transactions(date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant);
