-- Marchandage (Docs/03 §5 bis) : relation joueur ↔ marchand (réputation, bouderie) et journal des séances.

-- Réputation d'un joueur chez un marchand : +1 par jour où il y commerce (« habitué »), +1 par marchandage conclu,
-- −2 quand le marchand perd patience. Bornée [−5, 10]. sour_until : le marchand boude (pas de marchandage, devis −3 %).
CREATE TABLE merchant_relations (
  user_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  rep INTEGER NOT NULL DEFAULT 0,
  regular_day TEXT,                    -- dernier jour de Paris où la visite d'habitué a compté
  sour_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, merchant_id)
);

-- Une ligne par séance (sert aux limites journalières et à l'audit). outcome : open | deal | sour | walked
CREATE TABLE haggles (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  side TEXT NOT NULL,
  family TEXT NOT NULL,
  qty INTEGER NOT NULL,
  base_total INTEGER NOT NULL,
  final_total INTEGER,
  outcome TEXT NOT NULL DEFAULT 'open',
  cards TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX haggles_user_at ON haggles (user_id, at);
