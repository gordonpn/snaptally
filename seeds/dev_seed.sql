-- SYNTHETIC LOCAL DEMO ONLY. Never execute against production.
-- Fixed historical dates keep pagination and merchant fixtures reproducible.
INSERT INTO transactions (
    id, user_id, date, card, parent_bucket, subcategory, merchant,
    gross_amount, reimbursement, currency, created_at
)
VALUES
    ('demo-txn-001', 'usr_default', '2000-01-31', 'Demo Card', 'Guilt-Free', 'Groceries', 'Trader Joe''s', 42.50, 0.0, 'USD', '2000-01-31 12:00:00'),
    ('demo-txn-002', 'usr_default', '2000-01-30', 'Demo Card', 'Guilt-Free', 'Coffee & Snacks', 'George Howell', 5.50, 0.0, 'USD', '2000-01-30 12:00:00'),
    ('demo-txn-003', 'usr_default', '2000-01-29', 'Demo Card', 'Guilt-Free', 'Groceries', 'Whole Foods', 63.25, 10.0, 'USD', '2000-01-29 12:00:00'),
    ('demo-txn-004', 'usr_default', '2000-01-28', 'Demo Card', 'Fixed Costs', 'Rent', 'Demo Apartments', 1200.0, 0.0, 'USD', '2000-01-28 12:00:00'),
    ('demo-txn-005', 'usr_default', '2000-01-27', 'Demo Card', 'Guilt-Free', 'Dining', 'Demo Cafe', 25.0, 0.0, 'USD', '2000-01-27 12:00:00'),
    ('demo-txn-006', 'usr_default', '2000-01-26', 'Demo Card', 'Guilt-Free', 'Groceries', 'Trader Joe''s', -4.0, 0.0, 'USD', '2000-01-26 12:00:00'),
    ('demo-txn-007', 'usr_default', '1999-12-31', 'Demo Card', 'Guilt-Free', 'Coffee & Snacks', 'George Howell', 4.75, 0.0, 'USD', '1999-12-31 12:00:00'),
    ('demo-txn-008', 'usr_default', '1999-12-30', 'Demo Card', 'Fixed Costs', 'Utilities', 'Demo Utilities', 80.0, 0.0, 'USD', '1999-12-30 12:00:00')
ON CONFLICT(id) DO NOTHING;
