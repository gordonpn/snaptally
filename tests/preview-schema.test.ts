import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "node:test";

it("allows unchanged schemas and rejects new, edited, and removed PR migrations", () => {
  const script = resolve(".github/scripts/check-preview-schema.sh");
  const root = mkdtempSync(join(tmpdir(), "preview-schema-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    mkdirSync(join(root, "migrations"));
    writeFileSync(join(root, "migrations/0001.sql"), "SELECT 1;");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    const check = () =>
      execFileSync("bash", [script, base], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(check(), "safe=true");
    writeFileSync(join(root, "README.md"), "documentation only");
    git("add", ".");
    git("commit", "-qm", "docs");
    assert.equal(check(), "safe=true");
    writeFileSync(join(root, "migrations/0001.sql"), "SELECT 2;");
    git("add", ".");
    git("commit", "-qm", "edited migration");
    assert.equal(check(), "safe=false");
    git("revert", "--no-edit", "HEAD");
    writeFileSync(join(root, "migrations/0002.sql"), "SELECT 3;");
    git("add", ".");
    git("commit", "-qm", "new migration");
    assert.equal(check(), "safe=false");
    git("revert", "--no-edit", "HEAD");
    git("rm", "migrations/0001.sql");
    git("commit", "-qm", "removed migration");
    assert.equal(check(), "safe=false");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
