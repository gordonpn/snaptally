import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { intakeForm } from "../src/scripts/intake-form.ts";

// Execute the actual Alpine bindings used by the amount element, so assertions
// cover the template boundary without duplicating its formatting logic.
const activity = readFileSync(new URL("../src/pages/activity.astro", import.meta.url), "utf8");
const amount = activity.match(
  /class="font-mono font-bold text-sm"\s+:class="([^"]+)"\s*>\s*<span x-text="([^"]+)"/,
);
assert.ok(amount, "Activity amount bindings exist");
const amountClass = new Function("tx", `return (${amount[1]});`);
const amountText = new Function("tx", `return (${amount[2]});`);

describe("Income presentation", () => {
  it("labels Income submissions and preserves the negative-Income guard", () => {
    const form = intakeForm();
    assert.equal(form.submitButtonLabel, "Save Transaction");
    form.toggleNegative();
    assert.equal(form.submitButtonLabel, "Save Credit");
    form.selectBucket("Income");
    assert.equal(form.submitButtonLabel, "Save Income");
    form.toggleNegative();
    assert.equal(form.isNegative, false);
    assert.equal(form.submitButtonLabel, "Save Income");
    // Even an externally restored invalid negative state retains the Income label.
    form.isNegative = true;
    assert.equal(form.submitButtonLabel, "Save Income");
  });

  for (const currency of ["USD", "CAD"]) {
    const prefix = currency === "CAD" ? "CAD " : "";
    it(`renders ${currency} Income as a positive inflow`, () => {
      const tx = { parent_bucket: "Income", net_spend: "1234.5", currency };
      assert.equal(amountClass(tx), "text-success");
      assert.equal(amountText(tx), `${prefix}+$1234.50`);
    });
    it(`preserves ${currency} expense and credit formatting`, () => {
      const tx = { parent_bucket: "Guilt-Free", net_spend: "12.5", currency };
      assert.equal(amountClass(tx), "text-neu-text");
      assert.equal(amountText(tx), `${prefix}$12.50`);
      tx.net_spend = "-12.5";
      assert.equal(amountClass(tx), "text-secondary");
      assert.equal(amountText(tx), `${prefix}-$12.50`);
    });
    it(`preserves a negative ${currency} Income amount from historical or preview data`, () => {
      const tx = { parent_bucket: "Income", net_spend: "-25", currency };

      assert.equal(amountClass(tx), "text-secondary");
      assert.equal(amountText(tx), `${prefix}-$25.00`);
    });
  }
});
