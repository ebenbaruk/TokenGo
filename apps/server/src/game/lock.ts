// Verrou asynchrone par clé (serveur mono-processus) : sérialise les opérations d'un même joueur qui attendent un fournisseur
// externe (compile → octroi), là où une transaction SQLite synchrone ne suffit plus.
const tails = new Map<string, Promise<void>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = prev.then(() => new Promise<void>((r) => { release = r; }));
  tails.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
