# SnapTally Budgeting Methodology and Category Taxonomy

This document formalizes the budgeting framework, canonical parent buckets, subcategories, sinking fund workflows, and expense classification rules used across SnapTally.

---

## 1. Budgeting Framework: Conscious Spending Plan

SnapTally uses a budgeting framework inspired by Ramit Sethi's **Conscious Spending Plan (CSP)**. Rather than tracking hundreds of micro-budgets or restrictive itemized caps, income and expenses are grouped into four high-level buckets with benchmark percentage allocations based on net (after-tax) take-home pay:

| Bucket | Target Allocation | Description |
| :--- | :--- | :--- |
| **Fixed Costs** | 50% to 60% | Non-negotiable essentials, rent, utilities, groceries, transit, debt minimums, and core subscriptions. |
| **Investments** | 10%+ | Long-term wealth accumulation: retirement accounts (Roth IRA, 401k match), index funds, and brokerage deposits. |
| **Savings Goals** | 5% to 10% | Dedicated sinking funds for predictable future large expenditures (vacations, emergency reserve, annual bills). |
| **Guilt-Free Spending** | 20% to 35% | Discretionary day-to-day spending for lifestyle, hobbies, dining out, drinks, and impulse purchases. |

---

## 2. Canonical Category Taxonomy

> **Implementation status:** The transaction fields and calculations below describe the target budgeting model. In the initial baseline schema, transactions use a single free-form `category`. The expanded transaction schema adds `parent_bucket`, `subcategory`, `gross_amount`, `reimbursement`, and `net_spend`.

The target transaction model requires a `parent_bucket` and a `subcategory`. The canonical structure is defined below:

### 2.1. Fixed Costs (Parent Bucket: `Fixed Costs`)
Expenses necessary to live and work. These are generally predictable monthly commitments:

- `Rent / Mortgage`: Housing payments and HOA fees.
- `Utilities`: Electric, gas, water, trash, and internet.
- `Groceries`: Supermarket food, household essentials, and cleaning supplies (distinct from restaurant dining).
- `Transit`: Commuting expenses, subway/train passes, fuel, vehicle insurance, registration, and routine maintenance.
- `Phone`: Mobile carrier service bills.
- `Subscriptions`: Essential recurring software or utility subscriptions (cloud storage, password manager, work tooling).
- `Insurance`: Health, dental, renter, or life insurance premiums not deducted from payroll.
- `Debt Service`: Minimum payments on student loans, vehicle loans, or credit lines.

### 2.2. Investments (Parent Bucket: `Investments`)
Cash transferred from take-home pay into investment vehicles:

- `Retirement`: Post-tax contributions to Roth IRA or traditional IRA accounts.
- `Brokerage`: Automated transfers into taxable index funds or brokerage accounts.
- `Crypto / Other`: Alternative long-term asset purchases.

### 2.3. Savings Goals / Sinking Funds (Parent Bucket: `Savings`)
Allocations toward future known expenses or emergency protection:

- `Emergency Fund`: Contributions to liquid high-yield savings to maintain a 3- to 6-month safety net.
- `Travel Fund`: Sinking fund dedicated to flights, lodging, and planned vacations.
- `Annual Bills`: Amortized monthly savings for annual insurance premiums, taxes, or registrations.
- `Home Maintenance`: Reserves for household repairs and appliance replacements.
- `Special Events`: Savings for weddings, holiday gifts, or family celebrations.

### 2.4. Guilt-Free Spending (Parent Bucket: `Guilt-Free`)
Discretionary lifestyle purchases that can be spent freely without anxiety once the other three buckets are funded:

- `Dining`: Restaurants, takeout, food delivery, and casual meals out.
- `Coffee`: Cafes, espresso, and daily beverage runs.
- `Bars`: Drinks, pubs, lounges, and nightlife.
- `Entertainment`: Concerts, movies, sporting events, and recreational activities.
- `Shopping`: Clothing, electronics, gear, home decor, and personal items.
- `Hobbies`: Sports equipment, gaming, books, and creative projects.
- `Personal Care`: Haircuts, grooming, spa visits, and gym/fitness memberships.
- `Travel`: Discretionary trip expenses, spontaneous getaways, or vacation activities paid from current monthly cash flow (distinct from `Savings -> Travel Fund`).

---

## 3. Sinking Funds versus Monthly Discretionary Spend

A critical source of budget distortion is confusing **sinking fund drawdowns** with **monthly discretionary cash flow**.

### 3.1. Sinking Fund Mechanism
A sinking fund is an accrual reserve:
1. **Accumulation (Inflow):** You save a fixed dollar amount each month into high-yield savings (e.g. $400/month into `Travel Fund`). This counts toward your monthly 5% to 10% Savings target.
2. **Drawdown (Outflow):** When booking a $1,200 flight, that expenditure draws down against the accumulated $2,400 Travel Fund reserve.
3. **Budget Impact:** Sinking fund disbursements must **not** count against that month's Guilt-Free spending allowance. In downstream analysis, sinking fund expenses are evaluated against the specific fund balance, not the 20% to 35% monthly discretionary pool.

### 3.2. Categorizing Travel Spending
Travel expenses follow three distinct rules based on context:

1. **Major Vacation Bookings (Sinking Fund):**
   - Flights, hotels, long-term Airbnbs, train tours, and rental cars booked for a planned holiday.
   - **Parent Bucket:** `Savings`
   - **Subcategory:** `Travel Fund`
   - **Accounting Treatment:** Deducted from the cumulative Travel Fund balance.

2. **Spontaneous Leisure and Day Trips (Discretionary Cash Flow):**
   - Impromptu day trips, weekend road trips, or dining while on vacation paid directly from that month's paycheck.
   - **Parent Bucket:** `Guilt-Free`
   - **Subcategory:** `Travel`, `Dining`, `Entertainment`, or `Shopping`.
   - **Accounting Treatment:** Counts against the active month's Guilt-Free spending ceiling.

3. **Daily Commuting and Transit (Fixed Cost):**
   - Subway passes, bus fares, commuter rail, daily highway tolls, gas, and parking for work.
   - **Parent Bucket:** `Fixed Costs`
   - **Subcategory:** `Transit`
   - **Accounting Treatment:** Evaluated as part of non-negotiable living expenses.

---

## 4. Handling Reimbursements and Split Expenses

Transactions track both `gross_amount` and `reimbursement`, yielding `net_spend = gross_amount - reimbursement`:

1. **Split Dining / Group Payments:**
   - You pay a $120 dinner bill on your credit card; your friend sends you $60 via peer-to-peer transfer.
   - **Entry:** Gross = $120.00, Reimbursement = $60.00.
   - **Net Spend:** $60.00.
   - **Category:** `Guilt-Free -> Dining`.
   - **Budget Impact:** Only the $60.00 net cost impacts your monthly dining expenditure.

2. **Corporate / Reimbursable Work Travel:**
   - You book a $450 flight on a personal card that your employer will reimburse in full.
   - **Entry:** Gross = $450.00, Reimbursement = $450.00.
   - **Net Spend:** $0.00.
   - **Category:** `Fixed Costs -> Transit` or `Savings -> Travel Fund`.
   - **Budget Impact:** Neutral ($0.00 impact on monthly budget metrics).

---

## 5. Analysis Metrics and Calculations

With the dual-scope expansion into both intake and analysis, SnapTally computes the following monthly metrics:

1. **Monthly Bucket Totals:**
   $$\text{Bucket Spend} = \sum_{\text{bucket}} \text{net\_spend}$$
2. **Pacing and Burn Rate:**
   $$\text{Guilt-Free Daily Allowance} = \frac{\text{Monthly Target} - \text{Current Net Spend}}{\text{Days Remaining in Month}}$$
3. **Sinking Fund Balance Tracking:**
   $$\text{Current Fund Reserve} = \text{Initial Balance} + \sum \text{Allocations} - \sum \text{Drawdowns}$$
4. **Income Allocation Comparison:**
   Calculates actual spend percentages against the Conscious Spending Plan benchmarks (50-60% Fixed, 10%+ Investments, 5-10% Savings, 20-35% Guilt-Free).

---

## 6. Credit Card Multiplier and Payment Routing Matrix

> **Target Architecture Note:** The 6-bucket model below (`Fixed Essentials`, `Variable Essentials`, `Guilt-Free Living`, `Debt Service`, `Sinking Funds`, `Long-Term Wealth`) represents the planned expansion specified in Issue #41, refining the baseline 4-bucket schema from Section 2.

To maximize cash flow rewards without cognitive friction at the point of sale, categories map to target payment methods based on reward multipliers:

| Category Bucket | Subcategory | Target Card / Payment Method | Reward Optimization |
| :--- | :--- | :--- | :--- |
| **Fixed Essentials** | Rent & Housing | Checking ACH | Zero fee |
| | Core Utilities | Fidelity Rewards Visa | 2% cash back |
| | Transit & Commute | Fidelity Rewards Visa | 2% cash back (reserve Amex Gold for 3x flights) |
| | Phone & Internet (Net) | Fidelity Rewards Visa | 2% cash back after $50 subsidy |
| **Variable Essentials** | Groceries & Supermarkets | American Express Gold Card | 4x points (Star Market, H Mart, Trader Joe's) |
| | Household & Personal Care | Fidelity Rewards Visa | 2% cash back |
| **Guilt-Free Living** | Restaurants & Dining | American Express Gold Card | 4x points (sit-down dining, social outings) |
| | Fast Casual & Takeout | American Express Gold Card | 4x points (DoorDash, Grubhub, pickup) |
| | Cafes & Bakeries | American Express Gold Card | 4x points (espresso, bakeries, coffee beans) |
| | Entertainment & Recreation | Capital One Savor | 3% to 4% cash back on eligible entertainment ticket purchases |
| | Climbing & Fitness | Fidelity Rewards Visa | 2% cash back (gym dues and gear typically code as 1% on Savor) |
| | Personal Hobbies & Tech | PayPal Cashback Mastercard | 3% cash back when paying via PayPal checkout |
| **Debt Service** | CAD Family Loan Interest | Wise / Checking ACH | Low-fee FX remittance ($529.25 CAD/month interest-only) |
| **Sinking Funds** | Travel & Escapes | American Express Gold / Wealthsimple VIP | Point transfers, no foreign transaction fees |
| | Annual Subscriptions | Fidelity Rewards Visa | 2% cash back |
| **Long-Term Wealth** | Post-Tax Brokerage | Fidelity Brokerage | Direct index investing (VOO / VTI) |

---

## 7. Food Segregation and Basket Item Splitting

Broad category logging creates blind spots in spending analysis. SnapTally adopts two principles for detailed category tracking:

### 7.1 Food Segregation
Food expenditures must not be lumped into a single generic "Food" bucket. Home groceries are strictly separated from dining out and convenience takeout:
1. `Variable Essentials -> Groceries & Supermarkets`: Essential weekly home nutrition (Star Market, H Mart, Trader Joe's).
2. `Guilt-Free Living -> Restaurants & Dining`: Sit-down dinners, social gatherings, bars.
3. `Guilt-Free Living -> Fast Casual & Takeout`: Convenience delivery premiums and quick pickup.
4. `Guilt-Free Living -> Cafes & Bakeries`: Daily coffee runs, bakeries, and casual drinks.

This segregation clarifies whether a high food month was driven by grocery inflation or convenience delivery premiums.

### 7.2 Basket Item Splitting (Multi-Category Retailers)
Purchases at retailers like Amazon or Target often span multiple economic categories on a single receipt (for example, a $120 Amazon order containing $40 of household cleaning supplies and $80 of climbing or homelab gear). In accordance with Issue #62, purchases can be recorded as separate, unlinked entries sharing the same date and card:
- Entry A: $40.00 -> `Variable Essentials -> Household & Personal Care`
- Entry B: $80.00 -> `Guilt-Free Living -> Personal Hobbies & Tech`

---

## 8. Income Normalization and Pre-Tax Wealth Velocity

### 8.1 Biweekly 2-Check Baseline and the 3rd Paycheck Windfall
Because biweekly payroll produces 26 paychecks per year, 10 months have 2 paychecks and 2 months have 3 paychecks:
- **Baseline Budget**: All monthly targets are modeled against the standard **2-check baseline** (~$7,700/month net take-home).
- **The 3rd Paycheck Rule**: The two annual "3-check" windfall months (~$3,850 extra each) are never absorbed into recurring monthly lifestyle spending. They are treated as automatic lump-sum allocations directly into sinking funds (e.g. Travel, Emergency Buffer) or post-tax brokerage.
- **Social Security Withholding Cap**: In late-year months when the Social Security tax cap is reached and net take-home rises from ~$7,700 to ~$8,480, the extra ~$780/month difference is routed into sinking funds rather than inflating monthly lifestyle budgets.

### 8.2 Pre-Tax Wealth Velocity Banner
Traditional budgeting applications look only at post-tax checking accounts, creating the false impression that wealth velocity is lagging. SnapTally tracks automated payroll deductions alongside liquid investments:
- Traditional 401(k): $1,857.92/month
- Health Savings Account (HSA): $325.00/month
- Post-Tax Brokerage Surplus: ~$1,140.00/month
- **Durable Wealth Velocity**: Combining automated payroll investments with taxable brokerage yields **$3,322.92/month** in durable balance sheet growth.
- **Total Capital Allocations**: Including ~$1,100/month in sinking fund cash reserves (earmarked for deferred expenditures like travel and annual bills), total monthly non-lifestyle capital allocations exceed **$4,400/month**.

---

## 9. Cross-Border Real Estate and CAD Debt Servicing

SnapTally separates US domestic living cash flow from Canadian assets and debt servicing:

### 9.1 Family Loan Liability
- Principal: $146,000.00 CAD
- Interest Rate: 4.35% fixed APR
- Monthly Interest-Only Payment: $146,000 * 0.0435 / 12 = **$529.25 CAD/month** (~$370 to $390 USD/month); principal is not amortized.
- Servicing Channel: Wise remittance from US checking.

### 9.2 Montreal Duplex Cash Flow
- Gross Rental Revenue: Unit 2675 ($1,650 CAD) + Unit 2677 ($1,800 CAD) = **$3,450.00 CAD/month**.
- Operating Deductions: Municipal and school taxes, building insurance, CRA non-resident withholding, and maintenance reserves.
- Currency Conversion: Planned behavior: use a deterministic exchange rate peg (0.702 USD per CAD) and persist the rate per transaction via an fx_rate column, in accordance with Issue #63.
