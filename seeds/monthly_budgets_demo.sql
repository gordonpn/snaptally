-- OPT-IN LOCAL DEMO ONLY. Never run against production.
-- These four zero-value placeholders are not the owner's actual budget.
-- The fixed month and IDs make local fixture loading deterministic.
INSERT INTO monthly_budgets (id, year_month, parent_bucket, subcategory, target_amount)
VALUES
    ('demo-budget-2000-01-rent', '2000-01', 'Fixed Costs', 'Rent', 0.0),
    ('demo-budget-2000-01-emergency', '2000-01', 'Savings', 'Emergency Fund', 0.0),
    ('demo-budget-2000-01-investments', '2000-01', 'Investments', 'Investments', 0.0),
    ('demo-budget-2000-01-dining', '2000-01', 'Guilt-Free', 'Dining', 0.0)
ON CONFLICT DO NOTHING;
