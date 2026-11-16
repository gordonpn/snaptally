import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

// Mask comments and literals before checking tokens; SQLite parses the actual SQL.
export function conventions(sql, keywords) {
  const code = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"/g, " ");
  const errors = [];
  for (const token of code.match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? []) {
    if (keywords.includes(token.toUpperCase()) && token !== token.toUpperCase()) {
      errors.push(`Use uppercase keyword: ${token}`);
    }
  }
  const projections = code.replace(/COUNT\s*\(\s*\*\s*\)/gi, "COUNT(1)");
  if (
    /\bSELECT\s+(?:(?:DISTINCT|ALL)\s+)?(?:\w+\s*\.\s*)?\*|,\s*(?:\w+\s*\.\s*)?\*/i.test(
      projections,
    )
  ) {
    errors.push("SELECT requires explicit columns (COUNT(*) is allowed)");
  }
  for (const insert of code.matchAll(/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+\w+\b\s*([^\s])/gi)) {
    if (insert[1] !== "(") errors.push("INSERT requires an explicit column list");
  }
  return errors;
}

export function lintSql(root = process.cwd()) {
  const config = JSON.parse(readFileSync(resolve(root, "scripts/sql-lint.json"), "utf8"));
  const db = new DatabaseSync(":memory:");
  const errors = [];
  try {
    db.exec("PRAGMA foreign_keys = ON");
    for (const directory of config.directories) {
      for (const file of readdirSync(resolve(root, directory))
        .filter((f) => f.endsWith(".sql"))
        .sort()) {
        const name = `${directory}/${file}`;
        const sql = readFileSync(resolve(root, name), "utf8");
        errors.push(
          ...conventions(sql, config.uppercaseKeywords).map((error) => `${name}: ${error}`),
        );
        try {
          if (directory === "queries") {
            const numbered = [...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1]));
            const count = numbered.length ? Math.max(...numbered) : (sql.match(/\?/g) ?? []).length;
            const statement = db.prepare(`EXPLAIN QUERY PLAN ${sql}`);
            if (numbered.length) {
              statement.all(
                Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), null])),
              );
            } else statement.all(...Array(count).fill(null));
          } else db.exec(sql);
        } catch (error) {
          errors.push(`${name}: ${error.message}`);
        }
      }
    }
    for (const probe of config.indexProbes) {
      const details = db
        .prepare(`EXPLAIN QUERY PLAN ${probe.sql}`)
        .all()
        .map((row) => row.detail)
        .join("\n");
      if (!details.includes(probe.index)) errors.push(`Expected index ${probe.index}: ${details}`);
    }
  } finally {
    db.close();
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  lintSql();
  console.log("SQLite schema, query compilation, conventions and index probes passed.");
}
