// Connexion SQLite + migrations numérotées. better-sqlite3 est synchrone : une action = une transaction, pas de course.
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type DB = Database.Database;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const done = new Set((db.prepare('SELECT version FROM schema_version').all() as { version: number }[]).map((r) => r.version));
  const dir = join(dirname(new URL(import.meta.url).pathname), 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const v = Number(file.split('_')[0]);
    if (done.has(v)) continue;
    db.transaction(() => {
      db.exec(readFileSync(join(dir, file), 'utf8'));
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v);
    })();
  }
}

export const kvGet = <T>(db: DB, key: string): T | null => {
  const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return r ? (JSON.parse(r.value) as T) : null;
};
export const kvSet = (db: DB, key: string, value: unknown) =>
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
