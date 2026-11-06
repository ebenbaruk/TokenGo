-- Runners-agents, Google (anti-sybil), IOU de crédits, quotas, XP hebdo.
ALTER TABLE users ADD COLUMN is_agent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_norm TEXT;          -- email normalisé (gmail : sans points ni +tag) — anti-sybil, jamais affiché
ALTER TABLE users ADD COLUMN deleted_at INTEGER;       -- DELETE /api/me (anonymisé)
CREATE UNIQUE INDEX users_email_norm ON users(email_norm) WHERE email_norm IS NOT NULL;
CREATE INDEX users_agent ON users(is_agent);

-- État des runners-agents (profil + trajet en cours, JSON). Une ligne = un compte users(is_agent = 1).
CREATE TABLE runners (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile TEXT NOT NULL CHECK (profile IN ('walker','arbitrageur','forger','flooder')),
  state TEXT NOT NULL,
  next_at INTEGER NOT NULL
);

-- Octrois en attente (IOU, Docs/07 §2) : cible de limite enregistrée, essais.
ALTER TABLE grants ADD COLUMN target_nusd INTEGER;
ALTER TABLE grants ADD COLUMN tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE grants ADD COLUMN last_error TEXT;
CREATE INDEX grants_status ON grants(status, at);

-- Compteurs journaliers (quotas qui ne se déduisent pas d'une table existante : syncs).
CREATE TABLE daily_counts (user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (user_id, day, kind));

-- XP par jour de Paris (classement Runners de la semaine).
CREATE TABLE xp_daily (user_id TEXT NOT NULL, day TEXT NOT NULL, xp INTEGER NOT NULL, PRIMARY KEY (user_id, day));
CREATE INDEX xp_daily_day ON xp_daily(day);
CREATE INDEX trades_user_at ON trades(user_id, at);
CREATE INDEX rescues_user ON rescues(user_id);
