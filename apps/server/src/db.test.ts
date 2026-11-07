// Migrations : suivies par numéro (ensemble des versions appliquées), pas par « version max ». Une base créée avant
// l'intégration (001–004 + 007 + 008 déjà passées) doit recevoir 005 et 006 au démarrage suivant.
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.ts';

const DIR = join(import.meta.dirname, 'migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const version = (f: string) => Number(f.split('_')[0]);
const cols = (db: Database.Database, t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const tables = (db: Database.Database) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);

let tmp: string | null = null;
afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); tmp = null; });

describe('migrations', () => {
  it('base neuve : toutes les migrations, dans l’ordre', () => {
    const db = openDb(':memory:');
    const done = (db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[]).map((r) => r.version);
    expect(done).toEqual(files.map(version));
    expect(tables(db)).toEqual(expect.arrayContaining(['regions', 'city_events', 'codex', 'daily_routes', 'haggles']));
    expect(cols(db, 'users')).toEqual(expect.arrayContaining(['scout_state', 'seen_cell', 'seen_at']));
  });

  it('base existante déjà en 007/008 (sans 005/006) : 005 et 006 sont appliquées, rien n’est rejoué', () => {
    tmp = mkdtempSync(join(tmpdir(), 'tg-mig-'));
    const path = join(tmp, 'old.db');
    const old = new Database(path);
    old.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY)');
    for (const f of files.filter((x) => ![5, 6].includes(version(x)))) {
      old.exec(readFileSync(join(DIR, f), 'utf8'));
      old.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version(f));
    }
    old.prepare("INSERT INTO users (id, kind, handle, mode, created_at) VALUES ('u1', 'guest', 'Old·Timer', 'gps', 1)").run();
    old.close();

    const db = openDb(path); // rejouer 007/008 lèverait (CREATE TABLE sans IF NOT EXISTS)
    const done = (db.prepare('SELECT version FROM schema_version ORDER BY version').all() as { version: number }[]).map((r) => r.version);
    expect(done).toEqual(files.map(version));
    expect(tables(db)).toEqual(expect.arrayContaining(['regions', 'city_events']));
    expect(cols(db, 'users')).toEqual(expect.arrayContaining(['scout_state', 'seen_cell', 'seen_at']));
    expect((db.prepare("SELECT handle FROM users WHERE id = 'u1'").get() as { handle: string }).handle).toBe('Old·Timer');
    db.close();
    expect(() => openDb(path).close()).not.toThrow(); // idempotent
  });
});
