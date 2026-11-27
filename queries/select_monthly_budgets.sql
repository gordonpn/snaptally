-- Selects configured USD monthly budget targets for a specified calendar month (YYYY-MM).
SELECT
    id,
    year_month,
    parent_bucket,
    subcategory,
    target_amount
FROM monthly_budgets
WHERE year_month = ?1
ORDER BY parent_bucket ASC, subcategory ASC;
