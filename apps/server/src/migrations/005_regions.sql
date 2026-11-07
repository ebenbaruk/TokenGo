-- Monde « partout » : régions générées (cellule H3 r7) depuis OSM ou de façon procédurale, rechargées au démarrage.
CREATE TABLE regions (
  id TEXT PRIMARY KEY,            -- cellule H3 r7
  source TEXT NOT NULL,           -- 'osm' | 'procedural'
  created_at INTEGER NOT NULL,
  ip_hash TEXT,                   -- qui l'a déclenchée (plafond par IP et par jour)
  osm_elements INTEGER,           -- taille de la réponse Overpass (null : injoignable)
  nodes TEXT NOT NULL             -- WorldNode[] (JSON), déterministe pour une même réponse OSM
);
CREATE INDEX regions_created ON regions (created_at);
CREATE INDEX regions_ip ON regions (ip_hash, created_at);

-- Remote Scout : batterie (JSON ScoutState), null tant que le joueur n'a pas volé.
ALTER TABLE users ADD COLUMN scout_state TEXT;
