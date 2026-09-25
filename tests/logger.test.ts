import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Logger, type LogRecord, logger, sanitizeMetadata } from "../functions/api/logger.ts";

describe("structured logger", () => {
  describe("JSON formatting", () => {
    it("emits valid structured JSON containing level, timestamp, and message fields", () => {
      const records: LogRecord[] = [];
      const testLogger = new Logger({
        minLevel: "debug",
        sink: (entry) => {
          records.push(entry);
        },
      });

      testLogger.info("Transaction processed successfully");

      assert.strictEqual(records.length, 1);
      const entry = records[0];
      assert.strictEqual(entry.level, "info");
      assert.strictEqual(entry.message, "Transaction processed successfully");
      assert.ok(typeof entry.timestamp === "string");
      assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));

      const serialized = JSON.stringify(entry);
      const parsed = JSON.parse(serialized);
      assert.strictEqual(parsed.level, "info");
      assert.strictEqual(parsed.message, "Transaction processed successfully");
    });

    it("includes extra metadata fields at top level of the log entry", () => {
      const records: LogRecord[] = [];
      const testLogger = new Logger({
        sink: (entry) => records.push(entry),
      });

      testLogger.warn("Validation failed", { field: "amount", reason: "negative" });

      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].field, "amount");
      assert.strictEqual(records[0].reason, "negative");
    });
  });

  describe("sensitive parameter sanitization", () => {
    it("redacts sensitive keys regardless of casing", () => {
      const sensitiveData = {
        authorization: "Bearer secret-token-123",
        Authorization: "Bearer secret-token-456",
        token: "tok_abc789",
        apiKey: "key_xyz",
        API_KEY: "key_xyz",
        password: "supersecretpassword",
        secret: "mysecret",
        cookie: "session=abc",
        card: "Visa",
        amount: 25.5,
      };

      const sanitized = sanitizeMetadata(sensitiveData) as Record<string, unknown>;

      assert.strictEqual(sanitized.authorization, "[REDACTED]");
      assert.strictEqual(sanitized.Authorization, "[REDACTED]");
      assert.strictEqual(sanitized.token, "[REDACTED]");
      assert.strictEqual(sanitized.apiKey, "[REDACTED]");
      assert.strictEqual(sanitized.API_KEY, "[REDACTED]");
      assert.strictEqual(sanitized.password, "[REDACTED]");
      assert.strictEqual(sanitized.secret, "[REDACTED]");
      assert.strictEqual(sanitized.cookie, "[REDACTED]");
      assert.strictEqual(sanitized.card, "Visa");
      assert.strictEqual(sanitized.amount, 25.5);
    });

    it("recursively redacts nested objects and arrays", () => {
      const nested = {
        headers: {
          authorization: "Bearer sensitive",
          host: "api.example.com",
        },
        users: [
          { name: "Alice", token: "secret-token" },
          { name: "Bob", token: "another-token" },
        ],
      };

      const sanitized = sanitizeMetadata(nested) as typeof nested;

      assert.strictEqual(sanitized.headers.authorization, "[REDACTED]");
      assert.strictEqual(sanitized.headers.host, "api.example.com");
      assert.strictEqual(sanitized.users[0].token, "[REDACTED]");
      assert.strictEqual(sanitized.users[0].name, "Alice");
      assert.strictEqual(sanitized.users[1].token, "[REDACTED]");
      assert.strictEqual(sanitized.users[1].name, "Bob");
    });

    it("serializes Error instances into name and message objects", () => {
      const error = new Error("Database query failed");
      const sanitized = sanitizeMetadata(error) as { name: string; message: string };

      assert.strictEqual(sanitized.name, "Error");
      assert.strictEqual(sanitized.message, "Database query failed");
    });

    it("handles circular references without throwing", () => {
      const circular: Record<string, unknown> = { name: "test" };
      circular.self = circular;

      const sanitized = sanitizeMetadata(circular) as Record<string, unknown>;
      assert.strictEqual(sanitized.name, "test");
      assert.strictEqual(sanitized.self, "[CIRCULAR]");
    });
  });

  describe("log level filtering", () => {
    it("suppresses messages below configured minimum level", () => {
      const records: LogRecord[] = [];
      const testLogger = new Logger({
        minLevel: "warn",
        sink: (entry) => records.push(entry),
      });

      const debugResult = testLogger.debug("debug message");
      const infoResult = testLogger.info("info message");
      const warnResult = testLogger.warn("warning message");
      const errorResult = testLogger.error("error message");

      assert.strictEqual(debugResult, null);
      assert.strictEqual(infoResult, null);
      assert.notStrictEqual(warnResult, null);
      assert.notStrictEqual(errorResult, null);

      assert.strictEqual(records.length, 2);
      assert.strictEqual(records[0].level, "warn");
      assert.strictEqual(records[1].level, "error");
    });

    it("emits all levels when minLevel is debug", () => {
      const records: LogRecord[] = [];
      const testLogger = new Logger({
        minLevel: "debug",
        sink: (entry) => records.push(entry),
      });

      testLogger.debug("d");
      testLogger.info("i");
      testLogger.warn("w");
      testLogger.error("e");

      assert.strictEqual(records.length, 4);
    });

    it("defaults to info level when minLevel is omitted", () => {
      const records: LogRecord[] = [];
      const testLogger = new Logger({
        sink: (entry) => records.push(entry),
      });

      testLogger.debug("debug should be suppressed");
      testLogger.info("info should be emitted");

      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].message, "info should be emitted");
    });
  });

  describe("default logger export", () => {
    it("provides ready-to-use singleton logger instance", () => {
      assert.ok(typeof logger.info === "function");
      assert.ok(typeof logger.warn === "function");
      assert.ok(typeof logger.error === "function");
      assert.ok(typeof logger.debug === "function");
    });

    it("delegates to default console sink when sink is omitted", () => {
      const originalConsoleInfo = console.info;
      let loggedOutput = "";
      console.info = (message: string) => {
        loggedOutput = message;
      };
      try {
        const defaultLogger = new Logger();
        defaultLogger.info("Testing default console sink");
        assert.ok(loggedOutput.includes("Testing default console sink"));
      } finally {
        console.info = originalConsoleInfo;
      }
    });
  });
});
