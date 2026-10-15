-- Migration 0004: Migrate legacy 'Coffee' subcategory to 'Coffee & Snacks' for Guilt-Free bucket
UPDATE transactions
SET subcategory = 'Coffee & Snacks'
WHERE parent_bucket = 'Guilt-Free' AND subcategory = 'Coffee';
