-- Raid « Rogue Model » (Docs/13 §6) : boss coopératif de ville, un par événement de ville `rogue`.

-- Le boss d'un événement. status : active → won (PV à 0) | failed (temps écoulé) — résolu UNE fois (UPDATE … WHERE status = 'active').
CREATE TABLE raids (
  event_id INTEGER PRIMARY KEY,        -- city_events.id
  forge_id TEXT NOT NULL,
  boss TEXT NOT NULL,                  -- RaidBossId
  seed INTEGER NOT NULL,
  team TEXT NOT NULL,                  -- JSON Family[3] (maîtrise RAID.bossMastery)
  max_hp INTEGER NOT NULL,
  hp INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX raids_status ON raids (status);

-- Dégâts cumulés par participant (joueurs réels et runners-agents). families : JSON Family[] utilisées.
-- result : JSON RaidResultView une fois le raid résolu (joueurs réels seulement).
CREATE TABLE raid_damage (
  event_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  damage INTEGER NOT NULL DEFAULT 0,
  assaults INTEGER NOT NULL DEFAULT 0,
  families TEXT NOT NULL DEFAULT '[]',
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  result TEXT,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX raid_damage_user ON raid_damage (user_id, last_at);

-- Un assaut (3 manches). state : RaidAssaultState (packages/shared). status : open | done | expired
CREATE TABLE raid_assaults (
  id TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX raid_assaults_user ON raid_assaults (user_id, event_id);

-- Titres spéciaux du Codex gagnés par des exploits (« Rogue Slayer »), en plus des titres de collection.
CREATE TABLE user_titles (
  user_id TEXT NOT NULL,
  title_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, title_id)
);
