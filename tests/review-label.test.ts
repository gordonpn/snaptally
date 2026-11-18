import assert from "node:assert/strict";
import { test } from "node:test";
import { labelPublishedReview, labelReview, readReview } from "../.github/scripts/label-review.ts";

const sha = "a".repeat(40);
function output(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "review",
    markdown: "Review body",
    pr: { repo: "owner/repo", number: 12, head_sha: sha },
    ...overrides,
  });
}
function comment(body = "Review body", login = "github-actions[bot]") {
  return { id: 42, body, user: { login } };
}

test("labels the exact review with its provider snapshot revision", () => {
  const review = readReview(output(), "owner/repo", 12);
  assert.deepEqual(
    labelReview(review, [comment("Different review"), comment(), comment("Review body", "human")]),
    {
      id: 42,
      body: `Reviewed revision: ${sha}\n\nReview body`,
    },
  );
});

test("matches the pinned publisher identity marker without changing its body", () => {
  const review = { sha, markdown: "Heading\n\nReview body" };
  const body = "Heading\n\n<!-- pr-agent:review:full -->\n\nReview body";
  assert.deepEqual(labelReview(review, [comment(body)]), {
    id: 42,
    body: `Reviewed revision: ${sha}\n\n${body}`,
  });
});

test("refuses missing, malformed or mismatched output records", () => {
  for (const source of [
    "",
    "invalid",
    "null",
    `${output()}\n${output()}`,
    output({ markdown: "" }),
    output({ type: "describe" }),
    output({ pr: { repo: "other/repo", number: 12, head_sha: sha } }),
    output({ pr: { repo: "owner/repo", number: 12, head_sha: "bad" } }),
  ]) {
    assert.throws(() => readReview(source, "owner/repo", 12));
  }
  assert.throws(() => readReview(output(), "owner/repo", 13));
});

test("fails closed when publication cannot be uniquely identified", () => {
  const review = readReview(output(), "owner/repo", 12);
  for (const values of [
    null,
    [],
    [comment("Other")],
    [comment(), comment()],
    [comment("Review body", "human")],
  ]) {
    assert.throws(() => labelReview(review, values));
  }
});

test("retries preserve the same label and prefer a newly published review", () => {
  const review = readReview(output(), "owner/repo", 12);
  const labelled = comment(`Reviewed revision: ${sha}\n\nReview body`);
  assert.deepEqual(labelReview(review, [labelled]), { id: 42, body: labelled.body });
  assert.deepEqual(labelReview(review, [labelled, { ...comment(), id: 43 }]), {
    id: 43,
    body: labelled.body,
  });
  assert.throws(() =>
    labelReview(review, [comment(`Reviewed revision: ${"b".repeat(40)}\n\nReview body`)]),
  );
});

test("publication validates configuration and handles paginated HTTP success and failures", async (t) => {
  const names = ["GITHUB_REPOSITORY", "REVIEW_PR_NUMBER", "GITHUB_TOKEN", "REVIEW_OUTPUT_PATH"];
  const original = names.map((name) => process.env[name]);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    names.forEach((name, index) => {
      const value = original[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  });
  Object.assign(process.env, {
    GITHUB_REPOSITORY: "owner/repo",
    REVIEW_PR_NUMBER: "12",
    GITHUB_TOKEN: "test-token",
    REVIEW_OUTPUT_PATH: new URL("./fixtures/review-output.jsonl", import.meta.url).pathname,
  });
  for (const name of names) {
    const value = process.env[name];
    delete process.env[name];
    await assert.rejects(labelPublishedReview(), /Missing review publication configuration/u);
    process.env[name] = value;
  }
  for (const status of [403, 500]) {
    globalThis.fetch = async () => new Response(null, { status });
    await assert.rejects(labelPublishedReview(), /Comment lookup failed/u);
  }
  globalThis.fetch = async () => Response.json(null);
  await assert.rejects(labelPublishedReview(), /Invalid GitHub comment response/u);

  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    if (init?.method === "PATCH") {
      assert.equal(String(input), "https://api.github.com/repos/owner/repo/issues/comments/42");
      assert.deepEqual(JSON.parse(String(init.body)), {
        body: `Reviewed revision: ${sha}\n\nReview body`,
      });
      return new Response(null, { status: 200 });
    }
    return Response.json(
      calls.length === 1 ? Array.from({ length: 100 }, () => comment("Other")) : [comment()],
    );
  };
  await labelPublishedReview();
  assert.equal(calls.length, 3);
  assert.ok(calls[1]?.endsWith("page=2"));

  globalThis.fetch = async (_input, init) =>
    init?.method === "PATCH" ? new Response(null, { status: 403 }) : Response.json([comment()]);
  await assert.rejects(labelPublishedReview(), /Comment labeling failed with HTTP 403/u);
});
