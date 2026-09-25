import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timingSafeEqual, validateBearerToken } from "../functions/api/auth.ts";

describe("timingSafeEqual", () => {
  it("returns true for identical strings", async () => {
    assert.strictEqual(await timingSafeEqual("secret-token", "secret-token"), true);
  });

  it("returns false for different strings of same length", async () => {
    assert.strictEqual(await timingSafeEqual("secret-token", "wrong-token-"), false);
  });

  it("returns false for strings of different lengths", async () => {
    assert.strictEqual(await timingSafeEqual("short", "longer-secret-token"), false);
    assert.strictEqual(await timingSafeEqual("longer-secret-token", "short"), false);
  });

  it("returns false when one or both strings are empty", async () => {
    assert.strictEqual(await timingSafeEqual("", "secret-token"), false);
    assert.strictEqual(await timingSafeEqual("secret-token", ""), false);
    assert.strictEqual(await timingSafeEqual("", ""), true);
  });
});

describe("validateBearerToken", () => {
  const validToken = "test-secret-bearer-token";

  it("rejects request with missing Authorization header", async () => {
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
    });

    const response = await validateBearerToken(request, validToken);
    assert.notStrictEqual(response, null);
    assert.strictEqual(response?.status, 401);

    const body = (await response?.json()) as { error: string };
    assert.strictEqual(body.error, "Unauthorized");
  });

  it("rejects request with non-Bearer scheme", async () => {
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });

    const response = await validateBearerToken(request, validToken);
    assert.notStrictEqual(response, null);
    assert.strictEqual(response?.status, 401);

    const body = (await response?.json()) as { error: string };
    assert.strictEqual(body.error, "Unauthorized");
  });

  it("rejects request with malformed or empty Bearer token", async () => {
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: { Authorization: "Bearer   " },
    });

    const response = await validateBearerToken(request, validToken);
    assert.notStrictEqual(response, null);
    assert.strictEqual(response?.status, 401);
  });

  it("rejects request when expectedToken is undefined or empty", async () => {
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: { Authorization: `Bearer ${validToken}` },
    });

    const responseUndefined = await validateBearerToken(request, undefined);
    assert.strictEqual(responseUndefined?.status, 401);

    const responseEmpty = await validateBearerToken(request, "   ");
    assert.strictEqual(responseEmpty?.status, 401);
  });

  it("rejects request with invalid Bearer token", async () => {
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });

    const response = await validateBearerToken(request, validToken);
    assert.notStrictEqual(response, null);
    assert.strictEqual(response?.status, 401);

    const body = (await response?.json()) as { error: string };
    assert.strictEqual(body.error, "Unauthorized");
  });

  it("accepts request with valid Bearer token", async () => {
    const request = new Request("http://localhost/api/transactions", {
      method: "POST",
      headers: { Authorization: `Bearer ${validToken}` },
    });

    const response = await validateBearerToken(request, validToken);
    assert.strictEqual(response, null);
  });
});
