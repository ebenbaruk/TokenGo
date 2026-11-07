-- Arène des modèles et Maîtrise (Docs/13 §2, §4).

-- Arène tenue par un joueur (pas de ligne = le Gardien PNJ). Équipe et niveaux de maîtrise FIGÉS à la prise (fantôme).
-- active_at : dernière activité du Champion (combat, capture) → au-delà de 48 h, le Gardien reprend l'arène.
-- last_paid : revenu du Champion versé jusqu'à cet instant (+4 ƒ / 10 min, plafond par jour).
CREATE TABLE arenas (
  forge_id TEXT PRIMARY KEY,
  champion_user TEXT NOT NULL,
  team TEXT NOT NULL,                  -- JSON Family[3]
  mastery TEXT NOT NULL,               -- JSON { family: niveau }
  since INTEGER NOT NULL,
  active_at INTEGER NOT NULL,
  last_paid INTEGER NOT NULL
);
CREATE INDEX arenas_champion ON arenas (champion_user);

-- Un combat. opp : { kind: 'guardian' | 'champion', userId?, name, team, mastery }. state : ArenaBattleState (packages/shared).
-- status : open | won | lost | expired
CREATE TABLE battles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  forge_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  team TEXT NOT NULL,
  opp TEXT NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  result TEXT,                         -- JSON ArenaResultView une fois le combat fini
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX battles_user_at ON battles (user_id, created_at);

-- XP de maîtrise par joueur et par famille (niveau calculé : packages/shared/src/economy/arena.ts).
CREATE TABLE mastery (
  user_id TEXT NOT NULL,
  family TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, family)
);
