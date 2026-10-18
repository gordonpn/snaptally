INSERT INTO transactions (id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement, currency)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING;
