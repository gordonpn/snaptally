import assert from "node:assert/strict";
import { test } from "node:test";
import { labelReview, readReview } from "../.github/scripts/label-review.ts";

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
