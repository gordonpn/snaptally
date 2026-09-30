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
