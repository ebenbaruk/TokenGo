// Comptes logiques de l'outbox (`user:<id>`, `merchant:<mid>`) → comptes NEAR (`p-<short>.tokengo.testnet`, `<mid>.tokengo.testnet`).
// Le contrat stocke les soldes par AccountId sans exiger que le compte existe : la correspondance est fixée (table near_accounts)
// dès qu'une op est réglée ; le sous-compte lui-même est créé paresseusement (marchands, joueurs qui ont échangé ou compilé).
import type { DB } from '../db.ts';

const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Règles NEAR : 2 à 64 caractères, segments [a-z0-9] séparés par - ou _, parties séparées par des points. */
export const isValidAccountId = (id: string) => id.length >= 2 && id.length <= 64 && ACCOUNT_RE.test(id);

/** Partie « courte » d'un id joueur : alphanumérique minuscule, ≤ 20 caractères. */
export const shortUserId = (userId: string) => userId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'x';

/** Slug sûr pour un segment de compte NEAR (minuscules, séparateurs simples, pas de tiret en bord). */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

/** Préfixe d'espace de noms : '' en production, `dev-` ailleurs (évite que les bases de dev/e2e polluent les comptes de la démo). */
export const accountPrefix = (cfg: { NEAR_ACCOUNT_PREFIX?: string | undefined; prod: boolean }) => cfg.NEAR_ACCOUNT_PREFIX ?? (cfg.prod ? '' : 'dev-');

/** Libellé de sous-compte (sans le parent) pour un compte logique. */
export function labelFor(logical: string, prefix = ''): string {
  if (logical.startsWith('user:')) return `${prefix}p-${shortUserId(logical.slice(5))}`;
  if (logical.startsWith('merchant:')) return `${prefix}${slug(logical.slice(9))}`;
  throw new Error(`unknown logical account ${logical}`);
}

export const merchantNearId = (merchantId: string, contract: string, prefix = '') => `${labelFor(`merchant:${merchantId}`, prefix)}.${contract}`;

export interface NearAccountRow { account_id: string; owner: string; status: 'mapped' | 'created'; created_tx: string | null }

/**
 * Compte NEAR d'un compte logique ; crée la correspondance (status 'mapped') au premier appel.
 * Collision (deux ids joueurs qui donnent le même libellé) → suffixe numérique.
 */
export function accountFor(db: DB, logical: string, contract: string, prefix = ''): string {
  const row = db.prepare('SELECT account_id FROM near_accounts WHERE owner = ?').get(logical) as { account_id: string } | undefined;
  if (row) return row.account_id;
  const base = labelFor(logical, prefix);
  for (let i = 0; i < 100; i++) {
    const id = `${i ? `${base}${i}` : base}.${contract}`;
    if (!isValidAccountId(id)) throw new Error(`invalid NEAR account id ${id}`);
    if (db.prepare('SELECT 1 FROM near_accounts WHERE account_id = ?').get(id)) continue;
    db.prepare("INSERT INTO near_accounts (account_id, owner, status) VALUES (?, ?, 'mapped')").run(id, logical);
    return id;
  }
  throw new Error(`no free NEAR account id for ${logical}`);
}

/** Comptes à créer on-chain : marchands + joueurs qui ont échangé ou compilé (pas les visiteurs d'un instant). Joueurs d'abord. */
export function accountsToCreate(db: DB, limit: number): NearAccountRow[] {
  return db.prepare(`SELECT * FROM near_accounts WHERE status = 'mapped' AND (owner LIKE 'merchant:%'
      OR substr(owner, 6) IN (SELECT user_id FROM trades UNION SELECT user_id FROM compiles))
    ORDER BY owner LIKE 'user:%' DESC, rowid LIMIT ?`).all(limit) as NearAccountRow[];
}

export function markCreated(db: DB, accountId: string, owner: string, tx: string | null) {
  db.transaction(() => {
    db.prepare("UPDATE near_accounts SET status = 'created', created_tx = ? WHERE account_id = ?").run(tx, accountId);
    if (owner.startsWith('user:')) db.prepare('UPDATE users SET near_account = ? WHERE id = ?').run(accountId, owner.slice(5));
    else db.prepare('UPDATE merchants SET near_account = ? WHERE id = ?').run(accountId, owner.slice(9));
  })();
}
