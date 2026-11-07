-- Missions du jour (Docs/13 §7) et contrôle de la ville (Docs/13 §8).

-- Les 3 missions du jour d'un joueur, tirées à la première consultation du jour (graine jour + joueur) puis figées.
-- claimed : JSON MissionKind[] déjà réclamées ; chest_at : coffre des 3 versé (une fois par jour).
CREATE TABLE daily_missions (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kinds TEXT NOT NULL,                 -- JSON MissionKind[3]
  claimed TEXT NOT NULL DEFAULT '[]',
  chest_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

-- Compteurs du jour (clé = MissionKind : decode, arena_win, raid_damage…), incrémentés par les actions.
CREATE TABLE mission_counts (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, key)
);

-- Compteurs « distincts » (familles capturées, marchands visités) : un élément ne compte qu'une fois par jour.
CREATE TABLE mission_marks (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (user_id, day, key, item)
);

-- Contrôle de la ville : intervalles de détention des arènes par les Champions (end_at NULL = tenue en ce moment).
CREATE TABLE arena_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER
);
CREATE INDEX arena_holds_forge ON arena_holds (forge_id, end_at);
CREATE INDEX arena_holds_end ON arena_holds (end_at);
