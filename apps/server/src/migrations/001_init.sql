-- TokenGo : schéma initial. Montants = entiers (Flux, éclats, nano-USD).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('guest','google')),
  google_sub TEXT UNIQUE,
  email TEXT,
  handle TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'gps' CHECK (mode IN ('gps','demo')),
  demo_token INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  combo INTEGER NOT NULL DEFAULT 0,
  last_catch_at INTEGER,
  district INTEGER,
  tutorial TEXT NOT NULL DEFAULT '{}',
  tut_lat REAL, tut_lng REAL,
  move_state TEXT,
  walked_m INTEGER NOT NULL DEFAULT 0,
  in_transit INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '{}',
  near_account TEXT,
  created_at INTEGER NOT NULL,
  ip_hash TEXT
);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE inventory (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (user_id, token_id)
);
CREATE TABLE catches (
  user_id TEXT NOT NULL, spawn_id TEXT NOT NULL, at INTEGER NOT NULL, family TEXT NOT NULL, quality TEXT NOT NULL,
  PRIMARY KEY (user_id, spawn_id)
);
CREATE INDEX catches_user_at ON catches(user_id, at);
CREATE TABLE relay_syncs (user_id TEXT NOT NULL, node_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, node_id));
CREATE TABLE visits (user_id TEXT NOT NULL, node_id TEXT NOT NULL, first_at INTEGER NOT NULL, PRIMARY KEY (user_id, node_id));
CREATE TABLE merchants (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,            -- MerchantState JSON (packages/shared/economy/pricing.ts)
  version INTEGER NOT NULL DEFAULT 0,
  near_account TEXT
);
CREATE TABLE merchant_thoughts (
  id INTEGER PRIMARY KEY, merchant_id TEXT NOT NULL, at INTEGER NOT NULL, input TEXT, output TEXT, applied TEXT, source TEXT NOT NULL
);
CREATE INDEX thoughts_m ON merchant_thoughts(merchant_id, at);
CREATE TABLE price_seen (user_id TEXT NOT NULL, merchant_id TEXT NOT NULL, at INTEGER NOT NULL, prices TEXT NOT NULL, PRIMARY KEY (user_id, merchant_id));
CREATE TABLE trades (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, user_id TEXT NOT NULL, merchant_id TEXT NOT NULL, side TEXT NOT NULL,
  token_id TEXT NOT NULL, qty INTEGER NOT NULL, flux_total INTEGER NOT NULL, unit_prices TEXT NOT NULL
);
CREATE INDEX trades_m_at ON trades(merchant_id, at);
CREATE TABLE price_ticks (merchant_id TEXT NOT NULL, at INTEGER NOT NULL, mids TEXT NOT NULL, PRIMARY KEY (merchant_id, at));
CREATE TABLE ref_prices (at INTEGER PRIMARY KEY, p0 TEXT NOT NULL);
CREATE TABLE rescues (merchant_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, amount INTEGER NOT NULL);
CREATE INDEX rescues_m ON rescues(merchant_id, at);
CREATE TABLE compiles (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, user_id TEXT NOT NULL, forge_id TEXT NOT NULL, tier TEXT NOT NULL,
  inputs TEXT NOT NULL, fee INTEGER NOT NULL, pool TEXT, payout_nusd INTEGER NOT NULL, status TEXT NOT NULL,
  burn_tx TEXT, grant_ref TEXT
);
CREATE INDEX compiles_user_at ON compiles(user_id, at);
CREATE TABLE grants (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, user_id TEXT NOT NULL, pool TEXT NOT NULL, amount_nusd INTEGER NOT NULL,
  compile_id TEXT NOT NULL, status TEXT NOT NULL
);
CREATE INDEX grants_at ON grants(at);
CREATE TABLE api_keys (
  user_id TEXT PRIMARY KEY, nearai_key_id TEXT, key_enc TEXT NOT NULL, key_prefix TEXT NOT NULL,
  limit_nusd INTEGER NOT NULL, usage_nusd INTEGER NOT NULL DEFAULT 0, usage_at INTEGER, simulated INTEGER NOT NULL
);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE events (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, data TEXT);
CREATE TABLE chain_ops (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('mint','burn','transfer')),
  from_acc TEXT, to_acc TEXT, token_id TEXT NOT NULL, amount INTEGER NOT NULL, memo TEXT,
  status TEXT NOT NULL DEFAULT 'pending', settlement_id TEXT, tx_hash TEXT, tries INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX chain_ops_status ON chain_ops(status, id);
CREATE TABLE near_accounts (account_id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, status TEXT NOT NULL, created_tx TEXT);
