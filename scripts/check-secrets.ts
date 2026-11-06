// Vérifie qu'aucun secret n'est dans les fichiers suivis/indexés ni dans l'historique git.
import { execSync } from 'node:child_process';

const PATTERNS = [/ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /BEGIN [A-Z ]*PRIVATE KEY/, /GOCSPX-[A-Za-z0-9_-]{10,}/];
const sh = (c: string) => execSync(c, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

const hits: string[] = [];
const scan = (label: string, text: string) => {
  text.split('\n').forEach((line, i) => {
    if (PATTERNS.some((p) => p.test(line))) hits.push(`${label}:${i + 1}: ${line.slice(0, 80).replace(/(ed25519:|sk-)[^\s"']{6}[^\s"']*/g, '$1******')}`);
  });
};
for (const f of sh('git ls-files -c -o --exclude-standard').split('\n').filter(Boolean)) {
  if (/\.(json|png|jpg|wasm|lock)$/.test(f) && f.includes('data/')) continue;
  try { scan(f, sh(`git show :${JSON.stringify(f)} 2>/dev/null || cat ${JSON.stringify(f)}`)); } catch { /* binaire / supprimé */ }
}
scan('git-history', sh('git log -p --all 2>/dev/null || true'));
if (hits.length) {
  console.error(`✖ ${hits.length} secret(s) potentiel(s) :\n${hits.join('\n')}`);
  process.exit(1);
}
console.log('✔ check:secrets — aucun secret dans les fichiers ni l\'historique');
