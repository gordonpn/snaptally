import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCES = [
  ".mise.toml",
  "package.json",
  "pnpm-lock.yaml",
  "biome.json",
  ".github/actions/setup/action.yml",
  ".github/workflows/reviewdog.yml",
  "scripts/toolchain-policy.json",
] as const;
type Sources = Readonly<Record<(typeof SOURCES)[number], string>> & { readonly workflows: string };

function scalar(text: string, key: string): string {
  const matches = [
    ...text.matchAll(new RegExp(`^\\s*${key}\\s*[:=]\\s*["']?([\\d.]+)["']?\\s*(?:#.*)?$`, "gm")),
  ];
  assert.equal(matches.length, 1, `Expected one literal ${key} version`);
  const value = matches[0]?.[1];
  assert.ok(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

export function readToolchainSources(root: string): Sources {
  const read = (file: string): string => readFileSync(resolve(root, file), "utf8");
  const workflows = readdirSync(resolve(root, ".github/workflows"))
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => readFileSync(resolve(root, ".github/workflows", file), "utf8"))
    .join("\n");
  return {
    ".mise.toml": read(".mise.toml"),
    "package.json": read("package.json"),
    "pnpm-lock.yaml": read("pnpm-lock.yaml"),
    "biome.json": read("biome.json"),
    ".github/actions/setup/action.yml": read(".github/actions/setup/action.yml"),
    ".github/workflows/reviewdog.yml": read(".github/workflows/reviewdog.yml"),
    "scripts/toolchain-policy.json": read("scripts/toolchain-policy.json"),
    workflows,
  };
}

export function checkToolchain(sources: Sources): void {
  const mise = sources[".mise.toml"];
  const setup = sources[".github/actions/setup/action.yml"];
  const pkg = record(JSON.parse(sources["package.json"]));
  for (const [tool, ciKey] of [
    ["node", "node-version"],
    ["pnpm", "version"],
  ] as const) {
    const local = scalar(mise, tool);
    assert.match(local, /^\d+\.\d+\.\d+$/);
    const ci = scalar(setup, ciKey);
    assert.equal(ci, local.split(".")[0], `${tool}: CI must follow the local major track`);
  }
  assert.match(setup, /uses: actions\/setup-node@[a-f0-9]{40}/);
  assert.match(setup, /uses: pnpm\/action-setup@[a-f0-9]{40}/);
  assert.doesNotMatch(
    sources.workflows,
    /uses:\s*(?:actions\/setup-node|pnpm\/action-setup)@/,
    "Workflows must reuse the shared setup action to prevent tool version drift",
  );
  const minimum = record(pkg.engines).node;
  assert.ok(typeof minimum === "string");
  assert.match(minimum, /^>=\d+\.\d+\.\d+$/);
  assert.ok(
    new Intl.Collator("en", { numeric: true }).compare(scalar(mise, "node"), minimum.slice(2)) >= 0,
    "mise Node must satisfy package.json engines.node",
  );

  const biome = scalar(mise, "biome");
  assert.equal(record(pkg.devDependencies)["@biomejs/biome"], biome, "Biome package/mise drift");
  assert.equal(
    record(JSON.parse(sources["biome.json"])).$schema,
    `https://biomejs.dev/schemas/${biome}/schema.json`,
    "Biome schema/mise drift",
  );
  assert.match(
    sources["pnpm-lock.yaml"],
    new RegExp(
      `'@biomejs/biome':\\s+specifier: ${biome.replaceAll(".", "\\.")}\\s+version: ${biome.replaceAll(".", "\\.")}\\s`,
    ),
    "Biome lockfile/mise drift",
  );

  const policy = record(JSON.parse(sources["scripts/toolchain-policy.json"]));
  assert.equal(scalar(mise, "actionlint"), policy.localActionlint, "Local actionlint policy drift");
  assert.ok(typeof policy.reviewdogAction === "string");
  assert.ok(
    sources[".github/workflows/reviewdog.yml"]
      .split("\n")
      .some((line) => line.replace(/#.*$/, "").trim() === `uses: ${policy.reviewdogAction}`),
    "Reviewdog action changed: verify its bundled actionlint and update the policy",
  );
  assert.ok(typeof policy.bundledActionlint === "string");
  assert.match(policy.bundledActionlint, /^\d+\.\d+\.\d+$/);
  assert.ok(
    sources[".github/workflows/reviewdog.yml"].includes(
      '-ignore \'^unexpected key "queue" for "concurrency" section\\.\'',
    ),
    "Preserve the documented local/CI actionlint diagnostic exception",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkToolchain(readToolchainSources(process.cwd()));
  console.log("Toolchain declarations match the documented parity policy.");
}
