-- Carte vivante (Docs/03 §9, Docs/02 § Carte vivante).

-- Événements de ville : un seul actif à la fois (vérifié par le code), effets déjà bornés (rules.ts CITY_EVENT).
CREATE TABLE city_events (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  family TEXT,
  zone TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto','admin')),
  data TEXT NOT NULL                 -- CityEvent complet (JSON)
);
CREATE INDEX city_events_ends ON city_events(ends_at);

-- Présence des joueurs réels : seulement la cellule H3 r9 (~175 m), jamais la position exacte (vie privée).
ALTER TABLE users ADD COLUMN seen_cell TEXT;
ALTER TABLE users ADD COLUMN seen_at INTEGER;
CREATE INDEX users_seen ON users(seen_cell, seen_at);
