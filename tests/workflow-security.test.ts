import assert from "node:assert/strict";
import { describe, it } from "node:test";
import authorize from "../.github/scripts/authorize-pr-agent.js";

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
  await authorize({
    core: { setOutput: (_name: string, value: string) => (allowed = value) },
    context: {
      eventName,
      repo: { owner: "gordonpn", repo: "snaptally" },
      payload: {
        comment: { body, author_association: association },
        issue: { number: 12 },
        pull_request: eventName === "pull_request" ? { number: 12 } : undefined,
      },
    },
    github: {
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
  });
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
