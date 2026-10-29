import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLimit, parseOffset } from "../functions/api/query.ts";

describe("parseLimit", () => {
  it("returns defaultLimit when parameter is null, empty, or whitespace", () => {
    assert.strictEqual(parseLimit(null, 50, 200), 50);
    assert.strictEqual(parseLimit("", 50, 200), 50);
    assert.strictEqual(parseLimit("   ", 50, 200), 50);
  });

  it("parses valid positive integer within bounds", () => {
    assert.strictEqual(parseLimit("10", 50, 200), 10);
    assert.strictEqual(parseLimit("200", 50, 200), 200);
  });

  it("clamps values exceeding maxLimit to maxLimit", () => {
    assert.strictEqual(parseLimit("500", 50, 200), 200);
    assert.strictEqual(parseLimit("9999", 50, 200), 200);
  });

  it("falls back to defaultLimit for non-numeric, negative, or zero values", () => {
    assert.strictEqual(parseLimit("invalid", 50, 200), 50);
    assert.strictEqual(parseLimit("0", 50, 200), 50);
    assert.strictEqual(parseLimit("-5", 50, 200), 50);
  });

  it("rejects partial-numeric and floating-point inputs cleanly", () => {
    assert.strictEqual(parseLimit("10abc", 50, 200), 50);
    assert.strictEqual(parseLimit("abc10", 50, 200), 50);
    assert.strictEqual(parseLimit("1.5", 50, 200), 50);
    assert.strictEqual(parseLimit("1e3", 50, 200), 50);
  });
});

describe("parseOffset", () => {
  it("returns 0 when parameter is null, empty, or whitespace", () => {
    assert.strictEqual(parseOffset(null), 0);
    assert.strictEqual(parseOffset(""), 0);
    assert.strictEqual(parseOffset("   "), 0);
  });

  it("parses valid non-negative integer", () => {
    assert.strictEqual(parseOffset("0"), 0);
    assert.strictEqual(parseOffset("15"), 15);
    assert.strictEqual(parseOffset("100"), 100);
  });

  it("returns 0 for negative, non-numeric, floating-point, or unsafe integers", () => {
    assert.strictEqual(parseOffset("-5"), 0);
    assert.strictEqual(parseOffset("invalid"), 0);
    assert.strictEqual(parseOffset("15.5"), 0);
    assert.strictEqual(parseOffset("20abc"), 0);
    assert.strictEqual(parseOffset("99999999999999999999"), 0);
  });
});
