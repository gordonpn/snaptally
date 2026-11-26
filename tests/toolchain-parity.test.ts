import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { checkToolchain, readToolchainSources } from "../scripts/check-toolchain.ts";

const root = resolve(import.meta.dirname, "..");
const stubScript = resolve(root, "tests/fixtures/toolchain-stub.sh");

function readMiseVersion(miseToml: string, tool: string): string {
  const match = miseToml.match(new RegExp(`^\\s*${tool}\\s*=\\s*"([^"]+)"`, "m"));
  assert.ok(match?.[1], `Missing ${tool} version in .mise.toml`);
  return match[1];
}

describe("toolchain declaration parity", () => {
  it("accepts repository declarations through the CLI", () => {
    const result = spawnSync(process.execPath, ["scripts/check-toolchain.ts"], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /match the documented parity policy/);
  });

  for (const [name, file, before, after] of [
    ["Node major", ".mise.toml", 'node = "22.', 'node = "24.'],
    ["pnpm major", ".mise.toml", 'pnpm = "10.', 'pnpm = "11.'],
    ["Biome pin", ".mise.toml", 'biome = "2.6.8"', 'biome = "2.6.7"'],
    ["actionlint pin", ".mise.toml", 'actionlint = "1.7.7"', 'actionlint = "1.7.8"'],
    ["CI Node", ".github/actions/setup/action.yml", "node-version: 22", "node-version: 24"],
    ["CI pnpm", ".github/actions/setup/action.yml", "version: 10", "version: 11"],
    ["Biome package", "package.json", '"@biomejs/biome": "2.6.8"', '"@biomejs/biome": "2.6.9"'],
    ["Biome schema", "biome.json", "/2.6.8/", "/2.6.7/"],
    ["Biome lock", "pnpm-lock.yaml", "specifier: 2.6.8", "specifier: 2.6.7"],
    [
      "reviewdog pin",
      ".github/workflows/reviewdog.yml",
      "ae857e78c1b42b3d0a49637181b09d3d56d402b4",
      "0000000000000000000000000000000000000000",
    ],
    [
      "setup-node 41-char SHA",
      ".github/actions/setup/action.yml",
      "949feb2413d6458794dcd2491c4babbbce0c15c1",
      "949feb2413d6458794dcd2491c4babbbce0c15c10",
    ],
    [
      "action-setup 41-char SHA",
      ".github/actions/setup/action.yml",
      "73e46992e05b19abd31f2f3c20e0e7370d762115",
      "73e46992e05b19abd31f2f3c20e0e7370d762115a",
    ],
    [
      "setup-node short SHA",
      ".github/actions/setup/action.yml",
      "949feb2413d6458794dcd2491c4babbbce0c15c1",
      "949feb24",
    ],
    [
      "action-setup short SHA",
      ".github/actions/setup/action.yml",
      "73e46992e05b19abd31f2f3c20e0e7370d762115",
      "73e46992",
    ],
  ] as const) {
    it(`rejects ${name} drift`, () => {
      const sources = readToolchainSources(root);
      assert.ok(sources[file].includes(before), "Mutation must reach its intended declaration");

      assert.throws(() =>
        checkToolchain({ ...sources, [file]: sources[file].replace(before, after) }),
      );
    });
  }

  it("rejects a bypass of shared CI setup", () => {
    const sources = readToolchainSources(root);

    assert.throws(() =>
      checkToolchain({
        ...sources,
        workflows: `${sources.workflows}\n${sources[".github/actions/setup/action.yml"]}`,
      }),
    );
  });

  it("rejects matching short action references in policy and workflow", () => {
    const sources = readToolchainSources(root);
    const fullSha = "ae857e78c1b42b3d0a49637181b09d3d56d402b4";
    const shortSha = fullSha.slice(0, 8);

    assert.throws(() =>
      checkToolchain({
        ...sources,
        ".github/workflows/reviewdog.yml": sources[".github/workflows/reviewdog.yml"].replace(
          fullSha,
          shortSha,
        ),
        "scripts/toolchain-policy.json": sources["scripts/toolchain-policy.json"].replace(
          fullSha,
          shortSha,
        ),
      }),
    );
  });

  it("rejects an intentional mismatch through the CLI", () => {
    const sources = readToolchainSources(root);
    const directory = mkdtempSync(resolve(tmpdir(), "snaptally-toolchain-"));
    try {
      for (const [file, text] of Object.entries(sources)) {
        if (file === "workflows") continue;
        const path = resolve(directory, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(
          path,
          file === ".mise.toml" ? text.replace('biome = "2.6.8"', 'biome = "2.6.7"') : text,
        );
      }

      const result = spawnSync(process.execPath, [resolve(root, "scripts/check-toolchain.ts")], {
        cwd: directory,
        encoding: "utf8",
      });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Biome package\/mise drift/);
      assert.doesNotMatch(result.stdout, /match the documented parity policy/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("ignores version and node-version inputs in unrelated setup steps", () => {
    const sources = readToolchainSources(root);
    const setup = `${sources[".github/actions/setup/action.yml"]}\n    - name: Unrelated step\n      uses: example/other@0123456789abcdef0123456789abcdef01234567\n      with:\n        version: 99\n        node-version: 18\n`;

    assert.doesNotThrow(() =>
      checkToolchain({
        ...sources,
        ".github/actions/setup/action.yml": setup,
      }),
    );
  });

  for (const [key, value] of [
    ["version", "10"],
    ["node-version", "22"],
  ]) {
    it(`ignores ${key} environment variables in the setup step`, () => {
      const sources = readToolchainSources(root);
      const setup = sources[".github/actions/setup/action.yml"].replace(
        `        ${key}: ${value}\n`,
        `        ${key}: ${value}\n      env:\n        ${key}: 99\n`,
      );
      assert.doesNotThrow(() =>
        checkToolchain({ ...sources, ".github/actions/setup/action.yml": setup }),
      );
    });

    it(`rejects ${key} supplied only by the setup step environment`, () => {
      const sources = readToolchainSources(root);
      const setup = sources[".github/actions/setup/action.yml"].replace(
        `        ${key}: ${value}\n`,
        `      env:\n        ${key}: ${value}\n`,
      );
      assert.throws(() =>
        checkToolchain({ ...sources, ".github/actions/setup/action.yml": setup }),
      );
    });
  }

  it("handles direct step uses lines, step-leading with blocks, and keys before uses within a step", () => {
    const sources = readToolchainSources(root);
    const setup = sources[".github/actions/setup/action.yml"]
      .replace("    - name: Setup pnpm\n      uses:", "    - uses:")
      .replace(
        "    - name: Setup Node.js\n",
        "    - name: Setup Node.js\n      id: node\n\n      # pinned setup-node\n",
      );

    assert.doesNotThrow(() =>
      checkToolchain({
        ...sources,
        ".github/actions/setup/action.yml": setup,
      }),
    );

    const withFirstSetup = sources[".github/actions/setup/action.yml"].replace(
      "    - name: Setup pnpm\n      uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1\n      with:\n        version: 10\n",
      "    - with:\n        version: 10\n      uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1\n",
    );
    assert.notEqual(withFirstSetup, sources[".github/actions/setup/action.yml"]);
    assert.doesNotThrow(() =>
      checkToolchain({
        ...sources,
        ".github/actions/setup/action.yml": withFirstSetup,
      }),
    );
  });

  it("rejects missing scoped version even when an unrelated step declares it", () => {
    const sources = readToolchainSources(root);
    const setup = `${sources[".github/actions/setup/action.yml"].replace("        version: 10\n", "")}\n    - name: Unrelated step\n      uses: example/other@0123456789abcdef0123456789abcdef01234567\n      with:\n        version: 10\n`;

    assert.throws(
      () =>
        checkToolchain({
          ...sources,
          ".github/actions/setup/action.yml": setup,
        }),
      /Expected one literal version version/,
    );
  });

  it("rejects uses lines outside a YAML step block", () => {
    const sources = readToolchainSources(root);
    const setup = sources[".github/actions/setup/action.yml"].replace(
      "    - name: Setup pnpm\n      uses:",
      "uses:",
    );

    assert.throws(
      () =>
        checkToolchain({
          ...sources,
          ".github/actions/setup/action.yml": setup,
        }),
      /Expected pnpm\/action-setup uses: to belong to a YAML step/,
    );
  });

  it("accepts explicit repository root when check-toolchain runs from a subdirectory", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, "scripts/check-toolchain.ts"), root],
      {
        cwd: resolve(root, "scripts"),
        encoding: "utf8",
        env: { ...process.env, NODE_V8_COVERAGE: "" },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /match the documented parity policy/);
  });

  it("resolves repository root when verify-toolchain.sh runs from a subdirectory", () => {
    const sources = readToolchainSources(root);
    const mise = sources[".mise.toml"];
    const binDir = mkdtempSync(resolve(tmpdir(), "snaptally-toolchain-bin-"));
    try {
      for (const tool of ["mise", "node", "pnpm", "biome", "actionlint"]) {
        symlinkSync(stubScript, resolve(binDir, tool));
      }

      const env = {
        ...process.env,
        NODE_V8_COVERAGE: "",
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        REAL_NODE: process.execPath,
        EXPECTED_MISE_FILE: resolve(root, ".mise.toml"),
        STUB_NODE: readMiseVersion(mise, "node"),
        STUB_PNPM: readMiseVersion(mise, "pnpm"),
        STUB_BIOME: readMiseVersion(mise, "biome"),
        STUB_ACTIONLINT: readMiseVersion(mise, "actionlint"),
      };

      const pass = spawnSync("bash", [resolve(root, "scripts/verify-toolchain.sh")], {
        cwd: resolve(root, "scripts"),
        encoding: "utf8",
        env,
      });

      assert.equal(pass.status, 0, pass.stderr);
      assert.match(pass.stdout, /match the documented parity policy/);

      const fail = spawnSync("bash", [resolve(root, "scripts/verify-toolchain.sh")], {
        cwd: resolve(root, "scripts"),
        encoding: "utf8",
        env: { ...env, STUB_EXPECTED_NODE: env.STUB_NODE, STUB_NODE: "20.0.0" },
      });

      assert.notEqual(fail.status, 0);
      assert.match(fail.stderr, /node: expected /);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
