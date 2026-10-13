# SnapTally Modular Analytics and Intelligence Architecture

> **Implementation Status Note:** The endpoints (e.g. `/api/analysis/*`), database schemas (`monthly_audits`), and automated background runners described in this document represent the planned Phase 4 analytics architecture. In Phases 2 and 3, SnapTally focuses on point-of-sale intake and offline outbox synchronization.

This document specifies the architecture, data flow, statistical thresholds, deterministic calculation contracts, and structured LLM inference modules powering SnapTally's planned monthly analytics engine.

---

## 1. Architectural Philosophy and System Boundaries

SnapTally enforces a strict separation between **deterministic computation** and **semantic reasoning**:

1. **Arithmetic and Rule Validation Belong in Code**:
   - Tabular sums, averages, medians, percentage allocations, and multiplier reward calculations are executed deterministically on Cloudflare D1 (SQLite) and TypeScript edge functions.
   - Language models are never tasked with summing transactions, calculating reward rates, or computing percentages.
2. **Semantic Synthesis and Habit Evaluation Belong in LLMs**:
   - Models are deployed exclusively for pattern recognition, psychological trade-off evaluation, and strategic lifestyle recommendations.
   - Prompts receive pre-aggregated, sanitized JSON payloads containing statistical summaries and deterministic flags rather than raw transaction logs.
3. **Dual Execution Model**:
   - **On-Demand (Interactive)**: Triggered directly from the SnapTally mobile and desktop dashboard via `POST /api/analysis/audit`. Cached results render instantly; re-runs evaluate the active month against trailing baselines.
   - **Scheduled (Automated Background)**: Triggered on a monthly schedule (e.g. 1st of every month at 08:00 UTC via Cloudflare Cron Triggers). The background runner pre-computes metrics, executes model inference, persists audit records to D1, and dispatches a monthly executive digest via configured webhooks.

```mermaid
flowchart TD
    subgraph StorageLayer["Durable Storage (Cloudflare D1 - Planned Phase 4)"]
        RawTx[("Transactions Table")]
        Rules[("Card Multipliers & Category Rules")]
        SinkingLedger[("Sinking Fund Allocations & Drawdowns")]
        AuditStore[("Monthly Audit History (monthly_audits)")]
    end

    subgraph DeterministicEngine["Deterministic Edge Engine (Cloudflare Workers / TypeScript)"]
        Aggregator["SQL Window Aggregator\n(Medians, MoM Deltas, Rolling Baselines)"]
        SinkingReconciler["Sinking Fund Drawdown Reconciler\n(Reconciles planned charges against ledger)"]
        RewardsAuditor["Credit Card Rewards Leakage Auditor\n(Pure deterministic code; zero LLM calls)"]
        PayloadBuilder["Payload Builder & Token Guard (< 2,500 tokens)"]
    end

    subgraph UI["Mobile & Desktop Web Client (Planned Phase 4)"]
        DashboardUI["Dashboard Analytics View"]
        RewardsCard["Rewards Leakage UI Widget\n(Optimal card routing, missed cash back)"]
    end

    subgraph LLMInference["Inference Layer (Structured Outputs)"]
        InferenceMod1["Inference Module 1: Anomaly & Subscription Auditor\n(Price hikes, cadence drift, velocity surges)"]
        InferenceMod2["Inference Module 2: Strategic Cash Flow Synthesizer\n(Leverage matrix, behavioral guardrails)"]
    end

    RawTx --> Aggregator
    Rules --> RewardsAuditor
    RawTx --> RewardsAuditor
    RewardsAuditor -->|"Deterministic metrics (score, missed points)"| RewardsCard
    RewardsAuditor -->|"Summary score & leakage total"| PayloadBuilder

    SinkingLedger --> SinkingReconciler
    Aggregator --> SinkingReconciler
    SinkingReconciler --> PayloadBuilder

    PayloadBuilder -->|"Structured payload 1"| InferenceMod1
    PayloadBuilder -->|"Structured payload 2"| InferenceMod2

    InferenceMod1 --> AuditStore
    InferenceMod2 --> AuditStore
    AuditStore --> DashboardUI
```

---

## 2. Solution Space Comparison

| Strategy | Upstream Compute | Hallucination Risk | Token Cost and Latency | Operational Profile |
| :--- | :--- | :--- | :--- | :--- |
| **1. Monolithic Raw Dump**<br>(Raw CSV/rows fed into single prompt for categorization, math, and advice) | Minimal | Critical (LLMs hallucinate tabular totals, omit small transactions, drop schema bounds) | High ($O(N)$ tokens; high latency) | Unacceptable for financial tracking. |
| **2. Single-Pass Aggregate Synthesizer**<br>(Full monthly rollup into one prompt for all domains) | Moderate | Moderate | Low | Suffers from "loss in the middle"; model prioritizes obvious categories (dining) while ignoring recurring drift and card nuances. |
| **3. Decoupled Modular Analyzers (Adopted)**<br>(Deterministic pre-aggregation; isolated single-responsibility prompts; zero-LLM rewards math) | Moderate to High (SQL window functions compute metrics) | Near Zero | Minimal (parallelizable, compact payloads < 2,500 tokens) | Strictly deterministic, testable, reproducible, and resilient against API outages. |

---

## 3. Deterministic Pre-Computation Engine

### 3.1 Dual-Gate Velocity Thresholds
Traditional anomaly detection relying on parametric $z$-scores ($\mu \pm 2\sigma$) fails on consumer personal finance data due to small sample sizes ($N \le 3$ to $12$ months) and heavy skew. A single irregular month distorts standard deviation, hiding subsequent surges.

SnapTally replaces $z$-scores with **dual-gate non-parametric thresholds**:
1. **Relative Gate**: Active month category spend $\ge 1.30 \times$ trailing 3-month median spend.
2. **Absolute Dollar Gate**: Active month category spend minus trailing 3-month median spend $\ge \$75.00$.

Both gates must pass simultaneously before an anomaly flag is generated:
- **Inclusive Boundaries**: Comparisons are inclusive ($\ge$) to align with stated hurdle definitions.
- **Zero-Baseline Rule**: If trailing 3-month median spend is $\$0.00$ (e.g. a newly active category), the relative gate is treated as passed if the absolute gate is satisfied (spend $\ge \$75.00$). In the prompt payload, `relative_ratio` is serialized as `null` with a boolean flag `"is_new_category": true`.

This guarantees that small budget shifts (e.g. $\$12 \to \$18$ for cloud storage) never trigger velocity alarms, while genuine surges (e.g. $\$400 \to \$650$ for dining) are surfaced immediately.

### 3.2 Sinking Fund Drawdown Reconciliation
A common failure mode in personal budgeting systems is flagging large planned annual expenses (car insurance premiums, annual software subscriptions, holiday travel) as "lifestyle creep."

Before packaging anomaly payloads, the pre-computation engine reconciles transactions against user-configured sinking fund reserves:
1. **User-Selectable Sinking Categories**: Reconciles against active categories declared in `src/config/intake.ts` under parent bucket `Savings` (`Travel Fund`, `Emergency Fund`, `Annual Bills`, `Home Maintenance`, `Special Events`).
2. **Reserve Ledger Balance Contract**: Sinking fund reserves are computed via D1 aggregation queries:
   $$\text{Current Fund Reserve} = \text{Initial Balance} + \sum \text{Allocations} - \sum \text{Drawdowns}$$
3. **Reconciliation Suppression**: If a large or annual charge belongs to a sinking fund category or matches a recurring merchant linked to an active sinking fund allocation, and $\text{Current Fund Reserve} \ge 0$, the charge is treated as a funded planned drawdown and excluded from the anomaly alert payload passed to the language model.

---

## 4. Deterministic Credit Card Rewards Leakage Auditor (Zero LLM)

### 4.1 Specification and Rationale
Credit card rewards optimization is an exact mathematical problem based on deterministic category multipliers. Outsourcing this calculation to an LLM produces rounding errors, hallucinated multiplier values, and non-deterministic scoring.

In SnapTally, rewards leakage is computed **entirely in deterministic TypeScript and SQL**, bypassing the LLM completely.

### 4.2 Mathematical Contract
Rewards accrue on the **gross card charge** ($G_t = \text{gross\_amount}$), not net out-of-pocket spend, because issuers award points on the total transaction amount prior to third-party reimbursements.

Let transaction $t$ have gross amount $G_t$, category $C_t$, and card used $K_{\text{used}}$.
Let the wallet contain active cards $k \in \text{Wallet}$, where each card awards currency $\text{curr}(k)$ (e.g., cash back, Amex MR points) with multiplier $M(k, C_t)$ and a conservative valuation $V_{\text{rate}}(k)$ expressed in **dollars per reward unit** (e.g., $\$0.010$ per dollar for 1% cash back, $\$0.015$ per point for transferable travel points).

1. **Earned Value per Card on Transaction $t$**:
   $$E(t, k) = G_t \times M(k, C_t) \times V_{\text{rate}}(k)$$
2. **Actual Value Earned**:
   $$E_{\text{actual}, t} = E(t, K_{\text{used}})$$
3. **Optimal Card Selection**:
   $$K_{\text{optimal}, t} = \arg\max_{k \in \text{Wallet}} E(t, k)$$
   $$E_{\text{optimal}, t} = \max_{k \in \text{Wallet}} E(t, k)$$
4. **Estimated Dollar Value Lost per Transaction**:
   $$V_{\text{lost}, t} = \max(0, E_{\text{optimal}, t} - E_{\text{actual}, t})$$
5. **Total Value Lost Across Period**:
   $$V_{\text{lost}} = \sum_{t} V_{\text{lost}, t}$$
6. **Points Foregone by Program**:
   For each distinct reward currency $curr$, total unearned points are aggregated:
   $$P_{\text{lost}, curr} = \sum_{t: \text{curr}(K_{\text{optimal}, t}) = curr} G_t \times \max(0, M(K_{\text{optimal}, t}, C_t) - M(K_{\text{used}}, C_t))$$
7. **Wallet Efficiency Score**:
   $$\text{Efficiency} = \begin{cases} 100.0\%, & \text{if } \sum_t E_{\text{optimal}, t} = 0 \\ \left( \frac{\sum_t E_{\text{actual}, t}}{\sum_t E_{\text{optimal}, t}} \right) \times 100, & \text{otherwise} \end{cases}$$

### 4.3 Data Source and Fallback Rules
- **Rule Source**: Card multipliers and valuations are stored in persistent TypeScript configuration (`src/config/rewards.ts`) and extensible via D1 table `card_rewards`.
- **Fallback Behavior**: For unmapped card names or unclassified categories, the engine falls back to a base earning rate of $1.0\times$ at $\$0.010$ per unit (1% baseline).

### 4.4 UI Presentation Contract
The output renders directly in the SnapTally UI as a dedicated card without latency or external model cost:
- **Efficiency Metric**: Clean visual percentage (e.g., 94% optimal).
- **Leakage Summary**: Total missed cash equivalent in dollars (e.g., $14.20 foregone) and breakdown of points foregone by program.
- **Misrouted Categories**: Tabular breakdown of the top routing errors with clear corrective rules (e.g., "Use American Express Gold for Groceries rather than 2% Visa").

---

## 5. Inference Module 1: Anomaly and Subscription Creep Auditor (LLM-Assisted)

### 5.1 Objective
Audits recurring transactions and un-reconciled category velocity surges to detect silent price hikes, irregular frequency shifts, and unexpected lifestyle drift.

### 5.2 System Prompt

```text
You are an expert personal finance forensic auditor. Your task is to evaluate monthly recurring charges and category velocity anomalies.

Rules:
1. Ground every statement strictly in the provided data. Never invent figures or merchants.
2. Flag stealth price increases where current billing exceeds previous billing.
3. Identify zombie subscriptions where cadence or merchant activity suggests forgotten recurring commitments.
4. Distinguish between expected episodic spend and true lifestyle creep.
5. Provide actionable, high-leverage steps to eliminate waste.
6. Output valid JSON matching the schema with zero preamble and zero markdown wrapping.
```

### 5.3 Input Payload Contract (JSON)

```json
{
  "billing_period": "2026-10",
  "recurring_merchants": [
    {
      "merchant": "Streaming Service A",
      "current_amount": 22.99,
      "previous_amount": 19.99,
      "last_billed_date": "2026-10-04",
      "previous_billed_date": "2026-09-04",
      "cadence": "monthly",
      "flag": "amount_increased"
    },
    {
      "merchant": "Cloud Storage",
      "current_amount": 9.99,
      "previous_amount": 9.99,
      "last_billed_date": "2026-10-01",
      "previous_billed_date": "2026-09-01",
      "cadence": "monthly",
      "flag": "stable"
    }
  ],
  "category_velocity_outliers": [
    {
      "category": "Dining & Takeout",
      "current_total": 840.00,
      "trailing_3mo_median": 510.00,
      "relative_ratio": 1.65,
      "dollar_delta": 330.00,
      "is_new_category": false,
      "top_contributors": ["DoorDash ($210.00)", "Local Bistro ($185.00)"]
    }
  ],
  "sinking_fund_status": {
    "active_drawdowns_count": 2,
    "annual_charges_reconciled": true
  }
}
```

### 5.4 Output Schema Contract (Strict JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "subscription_alerts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "merchant": { "type": "string" },
          "severity": { "type": "string", "enum": ["HIGH", "MEDIUM", "LOW"] },
          "reason": { "type": "string" },
          "recommended_action": { "type": "string" }
        },
        "required": ["merchant", "severity", "reason", "recommended_action"],
        "additionalProperties": false
      }
    },
    "velocity_anomalies": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "category": { "type": "string" },
          "root_cause": { "type": "string" },
          "is_one_off": { "type": "boolean" },
          "actionable_leverage_point": { "type": "string" }
        },
        "required": ["category", "root_cause", "is_one_off", "actionable_leverage_point"],
        "additionalProperties": false
      }
    }
  },
  "required": ["subscription_alerts", "velocity_anomalies"],
  "additionalProperties": false
}
```

---

## 6. Inference Module 2: Strategic Cash Flow and Habit Synthesizer (LLM-Assisted)

### 6.1 Objective
Synthesizes high-level capital allocations against Conscious Spending Plan benchmarks (Fixed Costs, Investments, Savings Goals, Guilt-Free Spending) to provide executive-level behavioral guardrails and structural interventions.

### 6.2 System Prompt

```text
You are an executive personal balance sheet advisor. Your task is to analyze monthly income allocations and discretionary spending clusters.

Rules:
1. Ignore trivial cutbacks (< $30/month) unless they reflect systemic recurring drag.
2. Focus on structural expenses, contract negotiations, frequency caps, and automated behavioral friction.
3. Every recommendation must follow the Leverage Matrix: specify implementation friction (LOW, MEDIUM, HIGH), monthly run-rate savings, and psychological sustainability (integer 1 to 5).
4. Strictly avoid condescending tropes (e.g. cutting out coffee or dining out entirely). Emphasize conscious substitution and high-leverage friction.
5. Output valid JSON matching the schema with zero preamble and zero markdown wrapping.
```

### 6.3 Input Payload Contract (JSON)

```json
{
  "period": "2026-10",
  "macro_metrics": {
    "net_income": 7800.00,
    "fixed_costs_ratio": 0.52,
    "investments_ratio": 0.18,
    "savings_goals_ratio": 0.08,
    "guilt_free_ratio": 0.22,
    "wallet_efficiency_score": 93.5
  },
  "discretionary_clusters": [
    {
      "cluster": "Food Delivery Platforms",
      "monthly_spend": 385.00,
      "order_count": 12,
      "avg_ticket": 32.08
    },
    {
      "cluster": "Rideshare Apps",
      "monthly_spend": 240.00,
      "order_count": 8,
      "surge_percentage": 42.0
    }
  ]
}
```

### 6.4 Output Schema Contract (Strict JSON Schema)

```json
{
  "type": "object",
  "properties": {
    "capital_allocation_verdict": {
      "type": "string",
      "enum": ["OPTIMAL", "SLIGHT_DRIFT", "STRUCTURAL_DRAG", "CRITICAL_OVERSPEND"]
    },
    "high_leverage_interventions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "domain": { "type": "string" },
          "friction": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH"] },
          "monthly_run_rate_savings": { "type": "number" },
          "psychological_sustainability": { "type": "integer", "minimum": 1, "maximum": 5 },
          "specific_tactic": { "type": "string" },
          "behavioral_guardrail": { "type": "string" }
        },
        "required": [
          "domain",
          "friction",
          "monthly_run_rate_savings",
          "psychological_sustainability",
          "specific_tactic",
          "behavioral_guardrail"
        ],
        "additionalProperties": false
      }
    },
    "macro_observation": { "type": "string" }
  },
  "required": [
    "capital_allocation_verdict",
    "high_leverage_interventions",
    "macro_observation"
  ],
  "additionalProperties": false
}
```

---

## 7. Execution Architecture and Workflows

### 7.1 On-Demand Dashboard Trigger (Planned Phase 4)
```
User navigates to Dashboard -> Taps "Run Monthly Audit"
  │
  ├──> GET /api/analysis/rewards (Computes deterministic leakage in < 5ms)
  │      └──> Immediate render of Rewards Efficiency Card
  │
  └──> POST /api/analysis/audit (Triggers modular inference)
         ├──> Computes source data version (hash of latest transaction id and timestamp in month)
         ├──> Checks D1 cache for current month's audit matching transaction version
         ├──> If cache hit and valid:
         │      └──> Returns cached audit immediately
         ├──> If stale or uncomputed:
         │      ├──> Atomically claims audit execution in D1 (prevents concurrent duplicate runs)
         │      ├──> Executes SQL window queries for trailing 90 days
         │      ├──> Compiles compact payloads (< 2,000 tokens)
         │      ├──> Executes parallel calls to Inference Module 1 and Inference Module 2
         │      ├──> Persists structured results to D1 `monthly_audits` table
         │      └──> Returns unified JSON payload for Alpine.js dashboard display
```

### 7.2 Scheduled Monthly Cron Trigger (Planned Phase 4)
```
Cloudflare Cron Trigger fires (e.g. 0 8 1 * *)
  │
  ├──> Worker invokes runMonthlyScheduledAudit(month)
  ├──> Atomically claims audit for the target month
  ├──> Executes deterministic SQL aggregations
  ├──> Runs Inference Module 1 and Inference Module 2 with Structured Outputs
  ├──> Persists audit results and sets digest_status = 'pending' in D1 `monthly_audits`
  ├──> Dispatches markdown digest to configured webhook (Discord / Telegram)
  └──> Updates digest_status = 'delivered' upon successful HTTP 200 response
```

---

## 8. Failure Modes, Edge Cases, and Mitigations

1. **Merchant Normalization Inconsistencies and Descriptor Drift**:
   - Problem: Varied merchant billing strings (`AMZN Mktp US`, `Amazon.com`, `AMAZON PAY`) differ semantically rather than just in punctuation or casing, causing `toAlphanumericKey` to split recurring cadences.
   - Mitigation: Leverages an explicit alias mapping table (`merchant_aliases` in D1 and configurable mappings in `src/config/merchants.ts`) to resolve semantic variations to canonical entities prior to recurring-charge cadence evaluation.
2. **Context Window Expansion**:
   - Problem: High monthly transaction volume (150+ transactions) risks token bloat and context drift.
   - Mitigation: Never passes raw transaction rows. Payloads strictly contain aggregated cluster totals, count metrics, top 3 merchant items by dollar volume, and pre-computed statistical deltas.
3. **LLM Schema Non-Compliance**:
   - Problem: Free-form markdown formatting or missing JSON fields breaks dashboard parsers.
   - Mitigation: Enforces API-level **Structured Outputs** (`response_format: { type: "json_schema", json_schema: { strict: true } }`), with all array `items` explicitly typed as objects with `additionalProperties: false`.
4. **External API Outage or Network Timeout**:
   - Problem: DeepSeek or Gemini API experiences high latency (> 5000ms) or 5xx outages.
   - Mitigation: The dashboard immediately displays the deterministic metrics (CSP allocations and Credit Card Rewards Leakage). If the LLM call times out, the system generates fallback deterministic cards based directly on the raw anomaly flags without breaking the user experience.
5. **Concurrent Audit Execution and Webhook Delivery**:
   - Problem: Concurrent user clicks or overlapping cron triggers could duplicate LLM inferences and write conflicting results; network drops could cause silent webhook delivery loss.
   - Mitigation: Enforces atomic month claiming on `monthly_audits` (`PRIMARY KEY (user_id, month)`). Delivery state is tracked durably (`digest_status: 'pending' | 'delivered' | 'failed'`), allowing automatic background retry for failed webhook dispatches.
