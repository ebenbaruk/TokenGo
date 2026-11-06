-- Settler on-chain : un lot = un appel op_settle (Docs/06 §3). Les ops gardent leur settlement_id d'un essai à l'autre.
CREATE TABLE chain_settlements (
  id TEXT PRIMARY KEY,               -- settlement_id envoyé au contrat (s-<dbid>-<first>-<last>)
  first_op INTEGER NOT NULL, last_op INTEGER NOT NULL, n_ops INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','final','failed')),
  tx_hash TEXT,                      -- hash signé (connu avant l'envoi, sert à la reprise après un timeout)
  tries INTEGER NOT NULL DEFAULT 0, next_try_at INTEGER, error TEXT,
  gas_burnt INTEGER, ms INTEGER,
  created_at INTEGER NOT NULL, settled_at INTEGER
);
CREATE INDEX chain_settlements_status ON chain_settlements(status, first_op);
CREATE INDEX chain_settlements_at ON chain_settlements(settled_at);
CREATE INDEX chain_ops_settlement ON chain_ops(settlement_id);
CREATE INDEX chain_ops_from ON chain_ops(from_acc, id);
CREATE INDEX chain_ops_to ON chain_ops(to_acc, id);
