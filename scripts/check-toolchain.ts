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

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

function actionStepBlock(setup: string, action: string): string {
  const lines = setup.split(/\r?\n/);
  const escapedAction = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const usesPattern = new RegExp(
    `^\\s*(?:-\\s+)?uses:\\s*${escapedAction}@[a-f0-9]{40}(?![a-f0-9])(?:\\s+#.*|\\s*)$`,
  );
  const matchIndices = lines.flatMap((line, index) => (usesPattern.test(line) ? [index] : []));
  assert.equal(matchIndices.length, 1, `Expected one pinned ${action} step`);
  const [useIndex] = matchIndices;
  assert.ok(useIndex !== undefined);

  const usesLine = lines[useIndex];
  assert.ok(usesLine !== undefined);
  let start = -1;
  let stepIndent = 0;

  if (/^\s*-\s+uses:/.test(usesLine)) {
    start = useIndex;
    stepIndent = leadingSpaces(usesLine);
  } else {
    const usesIndent = leadingSpaces(usesLine);
    for (let i = useIndex - 1; i >= 0; i -= 1) {
      const candidate = lines[i] ?? "";
      if (/^\s*(?:#.*)?$/.test(candidate)) continue;
      if (leadingSpaces(candidate) >= usesIndent) continue;
      assert.match(candidate, /^\s*-\s/, `Expected ${action} uses: to belong to a YAML step`);
      start = i;
      stepIndent = leadingSpaces(candidate);
      break;
    }
    assert.ok(start >= 0, `Expected ${action} uses: to belong to a YAML step`);
  }

  let end = lines.length;
  for (let i = useIndex + 1; i < lines.length; i += 1) {
    const candidate = lines[i] ?? "";
    if (/^\s*(?:#.*)?$/.test(candidate)) continue;
    if (leadingSpaces(candidate) <= stepIndent) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// Only action inputs declare tool versions; similarly named environment variables do not.
function actionInputs(step: string): string {
  const lines = step.split("\n");
  const keyIndent = leadingSpaces(lines[0] ?? "") + 2;
  const withIndices = lines.flatMap((line, index) => {
    const isStepWith = index === 0 && /^\s*-\s+with:\s*(?:#.*)?$/.test(line);
    const isKeyWith = leadingSpaces(line) === keyIndent && /^\s*with:\s*(?:#.*)?$/.test(line);
    return isStepWith || isKeyWith ? [index] : [];
  });
  assert.equal(withIndices.length, 1, "Expected one with: block in setup step");
  const start = withIndices[0];
  assert.ok(start !== undefined);
  const startLine = lines[start] ?? "";
  const blockIndent = /^\s*-\s+/.test(startLine) ? startLine.indexOf("with:") : keyIndent;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (leadingSpaces(line) <= blockIndent) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
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
  for (const [tool, action, ciKey] of [
    ["node", "actions/setup-node", "node-version"],
    ["pnpm", "pnpm/action-setup", "version"],
  ] as const) {
    const local = scalar(mise, tool);
    assert.match(local, /^\d+\.\d+\.\d+$/);
    const step = actionStepBlock(setup, action);
    const ci = scalar(actionInputs(step), ciKey);
    assert.equal(ci, local.split(".")[0], `${tool}: CI must follow the local major track`);
  }
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
  assert.match(policy.reviewdogAction, /^reviewdog\/action-actionlint@[a-f0-9]{40}$/);
  assert.ok(
    sources[".github/workflows/reviewdog.yml"]
      .split("\n")
      .some((line) => line.replace(/#.*$/, "").trim() === `uses: ${policy.reviewdogAction}`),
    "Reviewdog action changed: verify its bundled actionlint and update the policy",
  );
  assert.ok(typeof policy.bundledActionlint === "string");
  assert.match(policy.bundledActionlint, /^\d+\.\d+\.\d+$/);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkToolchain(readToolchainSources(resolve(process.argv[2] ?? process.cwd())));
  console.log("Toolchain declarations match the documented parity policy.");
}
