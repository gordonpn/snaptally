import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeForm } from "../src/scripts/intake-form.ts";

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
});
