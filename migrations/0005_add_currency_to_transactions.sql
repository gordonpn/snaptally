-- Migration 0005: Add currency column to transactions table defaulting to 'USD'
ALTER TABLE transactions ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
