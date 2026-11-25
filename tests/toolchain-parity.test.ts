import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { checkToolchain, readToolchainSources } from "../scripts/check-toolchain.ts";

const root = resolve(import.meta.dirname, "..");

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
});
