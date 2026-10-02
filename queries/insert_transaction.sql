INSERT INTO transactions (id, date, card, parent_bucket, subcategory, merchant, gross_amount, reimbursement)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING;
