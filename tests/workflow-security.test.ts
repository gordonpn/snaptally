import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/pr-agent.yml"), "utf8");
const authorizationScript = workflow.match(/ {10}script: \|\n([\s\S]*?)\n {2}pr_agent:/)?.[1];
assert.ok(authorizationScript);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const authorize = new AsyncFunction(
  "core",
  "context",
  "github",
  authorizationScript.replace(/^ {12}/gm, ""),
);

async function checkAuthorization({
  eventName = "issue_comment",
  body = "/review",
  association = "OWNER",
  headRepository = "gordonpn/snaptally",
  draft = false,
  state = "open",
} = {}): Promise<{ allowed: string; lookups: number }> {
  let allowed = "";
  let lookups = 0;
  await authorize(
    { setOutput: (_name: string, value: string) => (allowed = value) },
    {
      eventName,
      repo: { owner: "gordonpn", repo: "snaptally" },
      payload: {
        comment: { body, author_association: association },
        issue: { number: 12 },
        pull_request: eventName === "pull_request" ? { number: 12 } : undefined,
      },
    },
    {
      rest: {
        pulls: {
          get: async (args: { pull_number: number }) => {
            assert.equal(args.pull_number, 12);
            lookups++;
            return { data: { state, draft, head: { repo: { full_name: headRepository } } } };
          },
        },
      },
    },
  );
  return { allowed, lookups };
}

describe("PR-Agent authorization before the secret-bearing job", () => {
  it("accepts supported commands and arguments from maintainers on same-repository PRs", async () => {
    for (const body of [
      "/review",
      "/describe",
      "/improve --extended",
      "/ask Why?",
      "/review\nplease",
    ])
      assert.deepEqual(await checkAuthorization({ body }), { allowed: "true", lookups: 1 });
  });

  it("rejects ordinary comments, command lookalikes and untrusted commenters before API lookup", async () => {
    for (const body of [
      "Looks good",
      "Please /review",
      "/reviewevil",
      "/ask-for-secrets",
      " /review",
    ])
      assert.deepEqual(await checkAuthorization({ body }), { allowed: "false", lookups: 0 });
    assert.deepEqual(await checkAuthorization({ association: "CONTRIBUTOR" }), {
      allowed: "false",
      lookups: 0,
    });
  });

  it("fails closed for fork, draft and closed PRs", async () => {
    for (const properties of [
      { headRepository: "attacker/snaptally" },
      { draft: true },
      { state: "closed" },
    ]) {
      assert.equal((await checkAuthorization(properties)).allowed, "false");
      assert.equal(
        (await checkAuthorization({ ...properties, eventName: "pull_request" })).allowed,
        "false",
      );
    }
  });

  it("allows the ready-for-review event only for an open same-repository PR", async () => {
    assert.equal((await checkAuthorization({ eventName: "pull_request" })).allowed, "true");
  });
});
