CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (id, name)
VALUES ('usr_default', 'Default User')
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    label TEXT,
    revoked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'usr_default' REFERENCES users(id) ON DELETE CASCADE,
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

INSERT INTO transactions_new (
    id,
    user_id,
    date,
    card,
    parent_bucket,
    subcategory,
    merchant,
    gross_amount,
    reimbursement,
    created_at
)
SELECT
    id,
    'usr_default',
    date,
    card,
    parent_bucket,
    subcategory,
    merchant,
    gross_amount,
    reimbursement,
    created_at
FROM transactions;

DROP TABLE transactions;

ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_date_created_at ON transactions(date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant);
CREATE INDEX IF NOT EXISTS idx_user_tokens_lookup ON user_tokens(token_hash, revoked_at);
