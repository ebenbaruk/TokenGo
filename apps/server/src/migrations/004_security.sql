-- Durcissement (revue de sécurité du 2026-11-06).

-- Tombstones de comptes supprimés : hachés (HMAC-like, sel = SESSION_SECRET) du google_sub et de l'email normalisé.
-- Une identité Google qui revient ne retouche pas le Welcome Pool et garde son flag de revue (Docs/08 §5).
CREATE TABLE account_tombstones (
  hash TEXT PRIMARY KEY,               -- sha256(secret:kind:valeur), kind ∈ sub | email
  flagged INTEGER,                     -- horodatage du flag anti-triche au moment de la suppression (NULL = non flaggé)
  welcome INTEGER NOT NULL DEFAULT 0,  -- 1 si un octroi Welcome Pool a été reçu
  deleted_at INTEGER NOT NULL
);

-- Pass démo (DEMO_TOKEN) : au plus un compte par IP (hachée) et par jour de Paris.
CREATE TABLE demo_passes (ip_hash TEXT NOT NULL, day TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (ip_hash, day));
