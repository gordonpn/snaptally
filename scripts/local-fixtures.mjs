import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const marker = ".snaptally-fixtures";
const identity = "SnapTally disposable local fixtures v1\n";

// No target, environment, database name or persistence path can be supplied by CLI.
export function localFixtures(args, root = process.cwd(), run = spawnSync) {
  if (args.length !== 1 || !["seed", "reset"].includes(args[0])) {
    throw new Error("Usage: node scripts/local-fixtures.mjs seed|reset (local only)");
  }
  const parent = resolve(root, ".wrangler");
  const state = resolve(parent, "dev-fixtures");
  for (const path of [parent, state]) {
    if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) {
      throw new Error(`Refusing non-directory or symlink: ${path}`);
    }
  }
  const ownership = resolve(state, marker);
  if (existsSync(state) && readdirSync(state).length > 0) {
    if (
      !existsSync(ownership) ||
      lstatSync(ownership).isSymbolicLink() ||
      readFileSync(ownership, "utf8") !== identity
    ) {
      throw new Error(
        "Refusing unowned fixture directory; preserve it and choose a clean checkout.",
      );
    }
  }
  if (args[0] === "reset") rmSync(state, { recursive: true, force: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(ownership, identity);
  const invoke = (args) => {
    const result = run(resolve(root, "node_modules/.bin/wrangler"), args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Local Wrangler failed (${result.status})`);
  };
  const target = ["budget-db", "--local", "--persist-to", state];
  invoke(["d1", "migrations", "apply", ...target]);
  for (const file of ["dev_seed.sql", "monthly_budgets_demo.sql"]) {
    invoke(["d1", "execute", ...target, "--file", resolve(root, "seeds", file)]);
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  localFixtures(process.argv.slice(2));
}
