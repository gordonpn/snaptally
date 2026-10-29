import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDateHeading,
  formatMonthName,
  getTodayDate,
  getYesterdayDate,
  isValidDate,
} from "../src/utils/date.ts";

describe("date utils", () => {
  describe("isValidDate", () => {
    it("validates correct YYYY-MM-DD dates", () => {
      assert.strictEqual(isValidDate("2026-10-29"), true);
      assert.strictEqual(isValidDate("2024-02-29"), true);
      assert.strictEqual(isValidDate("2026-01-01"), true);
    });

    it("rejects invalid date strings, leap years, and out-of-range days", () => {
      assert.strictEqual(isValidDate("2026-02-29"), false);
      assert.strictEqual(isValidDate("2026-13-01"), false);
      assert.strictEqual(isValidDate("2026-00-10"), false);
      assert.strictEqual(isValidDate("invalid"), false);
      assert.strictEqual(isValidDate(""), false);
      assert.strictEqual(isValidDate("2026-1-1"), false);
    });
  });

  describe("getTodayDate and getYesterdayDate", () => {
    it("formats today date accurately with custom Date parameter", () => {
      const fixed = new Date(2026, 9, 29); // October 29, 2026
      assert.strictEqual(getTodayDate(fixed), "2026-10-29");
    });

    it("formats yesterday date accurately crossing month boundaries", () => {
      const novFirst = new Date(2026, 10, 1); // November 1, 2026
      assert.strictEqual(getYesterdayDate(novFirst), "2026-10-31");
    });

    it("formats yesterday date accurately crossing year boundaries", () => {
      const janFirst = new Date(2027, 0, 1); // January 1, 2027
      assert.strictEqual(getYesterdayDate(janFirst), "2026-12-31");
    });
  });

  describe("formatDateHeading", () => {
    it("returns 'Today' for today's date", () => {
      const fixed = new Date(2026, 9, 29);
      assert.strictEqual(formatDateHeading("2026-10-29", fixed), "Today");
    });

    it("returns 'Yesterday' for yesterday's date", () => {
      const fixed = new Date(2026, 9, 29);
      assert.strictEqual(formatDateHeading("2026-10-28", fixed), "Yesterday");
    });

    it("returns raw date string for other dates", () => {
      const fixed = new Date(2026, 9, 29);
      assert.strictEqual(formatDateHeading("2026-10-27", fixed), "2026-10-27");
      assert.strictEqual(formatDateHeading("2026-09-15", fixed), "2026-09-15");
    });
  });

  describe("formatMonthName", () => {
    it("formats valid YYYY-MM strings into full month and year", () => {
      assert.strictEqual(formatMonthName("2026-10"), "October 2026");
      assert.strictEqual(formatMonthName("2025-01"), "January 2025");
      assert.strictEqual(formatMonthName("2024-12"), "December 2024");
    });

    it("returns 'This Month' for null, undefined, or invalid formats", () => {
      assert.strictEqual(formatMonthName(undefined), "This Month");
      assert.strictEqual(formatMonthName(""), "This Month");
      assert.strictEqual(formatMonthName("invalid-month"), "This Month");
    });
  });
});
