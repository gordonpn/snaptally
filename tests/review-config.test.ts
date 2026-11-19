import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function configuration(): Record<string, string> {
  return {
    DEEPSEEK_API_KEY: "test-provider",
    GITHUB_TOKEN: "test-github",
    DEEPSEEK_API_BASE: "https://api.deepseek.com",
  };
}

for (const workflow of ["pr-agent", "deepseek-review"]) {
  test(`${workflow} fails before review when required configuration is absent`, () => {
    const source = readFileSync(
      new URL(`../.github/workflows/${workflow}.yml`, import.meta.url),
      "utf8",
    );
    const command = source.match(/run: '(.+)'/u)?.[1];
    assert.ok(command);
    assert.equal(spawnSync("sh", ["-c", command], { env: configuration() }).status, 0);
    for (const name of Object.keys(configuration())) {
      for (const value of ["", undefined]) {
        const result = spawnSync("sh", ["-c", command], {
          env: { ...configuration(), [name]: value },
        });
        assert.notEqual(result.status, 0);
        assert.ok(!String(result.stderr).includes("test-provider"));
      }
    }
    for (const endpoint of ["bad", "http://api.deepseek.com", "https://"]) {
      assert.notEqual(
        spawnSync("sh", ["-c", command], {
          env: { ...configuration(), DEEPSEEK_API_BASE: endpoint },
        }).status,
        0,
      );
    }
  });
}
