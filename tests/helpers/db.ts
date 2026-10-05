import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Configuration options for initializing an in-memory test database.
 */
export interface TestDatabaseOptions {
  /**
   * Whether to enforce foreign key constraints. Defaults to true.
   */
  readonly foreignKeys?: boolean;

  /**
   * Directory containing migration SQL files. Defaults to the repository migrations directory.
   */
  readonly migrationsDir?: string;
}

/**
 * Resolves the directory path containing migration SQL files.
 *
 * @param customDir - Optional user-specified directory path.
 * @returns Absolute directory path.
 */
function resolveMigrationsDirectory(customDir?: string): string {
  if (customDir) {
    return resolve(customDir);
  }
  const fromMeta = import.meta.dirname ? resolve(import.meta.dirname, "../../migrations") : null;
  if (fromMeta && existsSync(fromMeta)) {
    return fromMeta;
  }
  return resolve("migrations");
}

/**
 * Creates an in-memory SQLite database with schema migrations applied.
 *
 * @param options - Configuration options for foreign keys and migrations path.
 * @returns Initialized SQLite database instance.
 * @throws Error if the migrations directory does not exist.
 */
export function createTestDatabase(options?: TestDatabaseOptions): DatabaseSync {
  const db = new DatabaseSync(":memory:");

  const enableForeignKeys = options?.foreignKeys ?? true;
  if (enableForeignKeys) {
    db.exec("PRAGMA foreign_keys = ON;");
  } else {
    db.exec("PRAGMA foreign_keys = OFF;");
  }

  const migrationsDir = resolveMigrationsDirectory(options?.migrationsDir);
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const sql = readFileSync(filePath, "utf-8");
    db.exec(sql);
  }

  return db;
}
