-- Codex (variantes cosmétiques des captures) et Daily Route.

-- Une ligne par case découverte (famille × variante). count = captures de cette variante.
CREATE TABLE codex (
  user_id TEXT NOT NULL,
  family TEXT NOT NULL,
  variant TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  place TEXT,                          -- monument de la première capture « landmark »
  PRIMARY KEY (user_id, family, variant)
);

-- Variante tirée à chaque capture réussie (NULL : capture antérieure au Codex, fuite).
ALTER TABLE catches ADD COLUMN variant TEXT;
-- Meilleur combo atteint (record du Codex).
ALTER TABLE users ADD COLUMN best_combo INTEGER NOT NULL DEFAULT 0;

-- Route du jour d'un joueur : arrêts figés à la création (JSON), arrêts validés, fin et récompense.
CREATE TABLE daily_routes (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,                   -- jour de jeu (Europe/Paris)
  anchor TEXT NOT NULL,                -- cellule H3 r8 du quartier
  stops TEXT NOT NULL,                 -- [{ id, kind, name, lat, lng }]
  done TEXT NOT NULL DEFAULT '[]',     -- ids validés
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (user_id, day)
);
