import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

async function install(pages: Record<string, string | Error>, failBundles = false) {
  let installHandler: (event: { waitUntil: (task: Promise<unknown>) => void }) => void = () => {
    throw new Error("Install handler was not registered");
  };
  let completion: Promise<unknown> | undefined;
  let activated = false;
  const batches: string[][] = [];
  runInNewContext(source, {
    self: {
      addEventListener(name: string, handler: typeof installHandler) {
        if (name === "install") installHandler = handler;
      },
      skipWaiting() {
        activated = true;
      },
    },
    caches: {
      async open() {
        return {
          async addAll(urls: string[]) {
            batches.push(Array.from(urls));
            if (failBundles && batches.length > 1) throw new Error("Unavailable bundle");
          },
          async match(page: string) {
            const html = pages[page];
            if (html instanceof Error) throw html;
            return html === undefined
              ? undefined
              : {
                  async text() {
                    return html;
                  },
                };
          },
        };
      },
    },
  });
  installHandler({
    waitUntil(task) {
      completion = task;
    },
  });
  await completion;
  return { batches, activated };
}

it("precaches unique bundles from intake and Activity before the first Activity visit", async () => {
  const result = await install({
    "/index.html": '<script src="/_astro/intake.js"></script><link href="/_astro/shared.css">',
    "/activity/index.html":
      '<script src="/_astro/activity.js"></script><link href="/_astro/shared.css">',
  });
  assert.deepEqual(result.batches[1], [
    "/_astro/intake.js",
    "/_astro/shared.css",
    "/_astro/activity.js",
  ]);
  assert.equal(result.activated, true);
});

it("continues discovery when a cached HTML page is missing or unreadable", async () => {
  for (const pages of [{}, { "/index.html": new Error("Unreadable") }]) {
    const result = await install({
      ...pages,
      "/activity/index.html": '<script src="/_astro/activity.js"></script>',
    });
    assert.deepEqual(result.batches[1], ["/_astro/activity.js"]);
    assert.equal(result.activated, true);
  }
});

it("does not abort installation when discovered bundles cannot be cached", async () => {
  const result = await install(
    { "/activity/index.html": '<script src="/_astro/activity.js"></script>' },
    true,
  );
  assert.equal(result.activated, true);
});
