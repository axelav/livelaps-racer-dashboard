import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS archive_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = db.prepare('SELECT 1 FROM archive_migrations WHERE name = ?');
  const record = db.prepare(
    'INSERT INTO archive_migrations (name, applied_at) VALUES (?, ?)'
  );
  const apply = db.transaction((name, sql) => {
    db.exec(sql);
    record.run(name, new Date().toISOString());
  });

  for (const name of readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort()) {
    if (!applied.get(name)) apply(name, readFileSync(join(migrationsDirectory, name), 'utf8'));
  }
}

export function openDatabase(filename) {
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}
