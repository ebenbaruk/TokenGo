// Soumission NEAR HACKATHON — UNIQUEMENT lancée par l'humain.
//   node scripts/submit.ts            → valide et affiche le JSON exact (rien n'est envoyé)
//   node scripts/submit.ts --send     → envoie (POST https://nearhackathon.com/api/applications)
// Les champs personnels vont dans var/submission.json (gitignoré) ; modèle : scripts/submission.example.json.
// Règles : https://nearhackathon.com/HACKATHON.md (relire juste avant d'envoyer).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const ENDPOINT = 'https://nearhackathon.com/api/applications';
const TRACKS = ['defi', 'thesis', 'privacy', 'business', 'swarms', 'security', 'agents', 'realworld', 'games', 'nfts', 'memecoins', 'social', 'open'];
const SIZES = ['1', '2 - 4', '4 - 6', '6 - 8', '8+'];
const CONSENT_TEXT = 'I agree that the organizers may use these details to review our submission and contact us about this hackathon.';

interface Fields {
  judgeLink?: string; // ajouté à la fin de idea : « Play: … · Judges' pass: … »
  playUrl?: string;
  projectName: string; leadName: string; email: string; size: string; tracks: string[];
  nearAddress: string; projectUrl: string; demoUrl: string; idea: string; consent: boolean;
}

const send = process.argv.includes('--send');
const path = 'var/submission.json';
if (!existsSync(path)) {
  console.error(`✘ ${path} manquant : copier scripts/submission.example.json vers ${path} et remplir les champs.`);
  process.exit(1);
}
const input = JSON.parse(readFileSync(path, 'utf8')) as Partial<Fields>;
const links = [input.playUrl ? `Play: ${input.playUrl}` : '', input.judgeLink ? `Judges' pass (level-7 account, real credits): ${input.judgeLink}` : ''].filter(Boolean).join(' · ');
const idea = [input.idea ?? readFileSync('scripts/submission-idea.txt', 'utf8').trim(), links].filter(Boolean).join('\n\n');

mkdirSync('var', { recursive: true });
const ridPath = 'var/submission-request-id';
if (!existsSync(ridPath)) writeFileSync(ridPath, randomUUID());
const requestId = readFileSync(ridPath, 'utf8').trim();

const body = {
  requestId,
  projectName: input.projectName ?? 'TokenGo',
  leadName: input.leadName ?? '',
  email: input.email ?? '',
  size: input.size ?? '1',
  tracks: input.tracks ?? ['games'],
  nearAddress: input.nearAddress ?? '',
  projectUrl: input.projectUrl ?? 'https://github.com/ebenbaruk/TokenGo',
  demoUrl: input.demoUrl ?? '',
  idea,
  consent: input.consent === true,
};

const errors: string[] = [];
const len = (k: string, v: string, min: number, max: number) => { if (v.length < min || v.length > max) errors.push(`${k}: ${min}–${max} caractères (actuel ${v.length})`); };
len('projectName', body.projectName, 2, 80);
len('leadName', body.leadName, 2, 80);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 160) errors.push('email invalide');
if (!SIZES.includes(body.size)) errors.push(`size ∈ ${SIZES.join(' | ')}`);
if (!body.tracks.length || body.tracks.some((t) => !TRACKS.includes(t)) || new Set(body.tracks).size !== body.tracks.length) errors.push('tracks invalides');
if (!/^[a-z0-9._-]{2,64}$/.test(body.nearAddress) || body.nearAddress.endsWith('.testnet')) errors.push('nearAddress : compte mainnet en minuscules (2–64)');
for (const k of ['projectUrl', 'demoUrl'] as const) if (!/^https?:\/\/\S+$/.test(body[k]) || body[k].length > 300) errors.push(`${k} : URL http(s) ≤ 300`);
if (!/^https:\/\/(x|twitter)\.com\//.test(body.demoUrl)) errors.push('demoUrl : doit être le lien du post X (vidéo + #NEARHackathon + @NEARProtocol)');
len('idea', body.idea, 20, 2000);
if (!body.consent) errors.push(`consent : mettre true après avoir accepté : « ${CONSENT_TEXT} »`);
const json = JSON.stringify(body, null, 2);
if (Buffer.byteLength(json) > 12_000) errors.push('corps > 12 000 octets');

console.log(json);
if (errors.length) {
  console.error(`\n✘ À corriger dans ${path} :\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
if (!send) {
  console.log('\n✔ Valide. Rien n’a été envoyé. Pour soumettre : node scripts/submit.ts --send');
  process.exit(0);
}

const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const text = await res.text();
const advice: Record<number, string> = {
  201: '✔ Submission saved. Corrections : https://nearhackathon.com/request-changes',
  400: 'Champ invalide (voir `fields`) : corriger puis relancer (même requestId).',
  403: 'Soumissions fermées ou requête jugée cross-site : ne pas réessayer.',
  409: 'Repo déjà soumis ou email déjà utilisé 2 fois : ne pas contourner.',
  413: 'Trop long : raccourcir idea.',
  503: 'Stockage indisponible : attendre une minute puis relancer (même requestId).',
};
console.log(`\nHTTP ${res.status} ${text}\n${advice[res.status] ?? ''}`);
process.exit(res.status === 201 ? 0 : 1);
