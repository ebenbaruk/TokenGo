# Soumission — brouillons prêts (rien n'est envoyé sans le « oui » du propriétaire)

Procédure : `Docs/10-demo-and-judging.md` §6. Relire https://nearhackathon.com/HACKATHON.md juste avant (les règles peuvent changer).
Deadline : **2026-11-14 23:59 UTC** (viser avant 18:00 UTC). Démo en ligne jusqu'au **2026-11-25**.

## Reste à faire par l'humain (bloquant)
1. Héberger la démo (Railway : `railway up` avec le Dockerfile + un volume monté sur `/data`, variables de `.env.example`, `TRUST_PROXY=1`,
   `NODE_ENV=production`, `PUBLIC_URL=https://…`, secrets générés : `openssl rand -base64 32` pour `MASTER_KEY`, `SESSION_SECRET`, `SPAWN_SECRET`,
   `DEMO_TOKEN`, `ADMIN_TOKEN`). Claude peut le faire si on lui donne un token Railway.
2. Crédits réels : HUMAN-TODO 1–3 (sinon la démo publique tourne en crédits simulés, ce qui reste jouable mais moins fort).
3. Rendre le repo public (avec OK), filmer/publier la vidéo + post X, donner les champs ci-dessous.

## Champs (à demander à l'humain — ne jamais inventer)
| Champ | Valeur |
|---|---|
| projectName | TokenGo |
| leadName | _à fournir_ |
| email | _à fournir_ |
| size | 1 |
| tracks | ["games", "agents"] |
| nearAddress | _compte mainnet du propriétaire (HUMAN-TODO 6)_ |
| projectUrl | https://github.com/ebenbaruk/TokenGo (une fois public) |
| demoUrl | _URL du post X_ |
| idea | voir ci-dessous |
| consent | _à confirmer_ |
Ne pas envoyer le champ `website` (piège à spam). `requestId` : généré une fois, gardé dans `var/submission-request-id`.

## `idea` (≈ 1 400 caractères)
TokenGo is a location-based browser game where the loot is real AI compute. You walk Paris and catch shards of Claude, GPT, DeepSeek,
Gemini and Qwen that spawn around real landmarks (libraries favour Claude, stations GPT, parks Gemini). 153 AI merchants — each with its
own NEAR account and an LLM brain running on NEAR AI Cloud — buy and sell shards at prices set by local supply and demand, so walking
from one café to another is arbitrage. Merchants import, export, pay rent, go bankrupt and get rescued by players; an LLM tunes their
margins and contracts every 3 hours inside hard clamps, and every price comes with a "Why this price?" breakdown from one readable rules
file. Forges on monuments compile daily recipes into real NEAR AI Cloud credits on the player's own API key — the only door from the game
to real value, paid as a fraction of a capped reserve so the game is solvent by construction. Every item is a NEP-245 token on testnet,
settled in batches; every real cent is preceded by an on-chain burn proof. No wallet, no seed phrase, no gas: guests play in seconds,
24 runner-agents keep the market alive, and an in-browser Economy Lab simulates a week of Paris with 200 bots in under a second
using the exact live rules.

## Post X (≤ 280 car. par tweet ; l'humain publie)
```
What if Pokémon-Go-style loot was real AI compute? 🗺️⚡

TokenGo: walk Paris, catch shards of Claude, GPT, DeepSeek, Gemini & Qwen, trade them with AI merchants (each with its own NEAR account & prices from supply/demand), then forge them into real NEAR AI Cloud credits.

#NEARHackathon @NEARProtocol
▶️ <demo url> · 💻 <repo>
```

## Vidéo (≤ 2 min 30) — plan et images
Script : `Docs/10-demo-and-judging.md` §4. Images clés : `npm run shots` → `docs-assets/shots/` (splash, carte, capture, marchand
« Why this price? », ticket de crédit, playground, Lab flood, Pulse). Plans réels dans la rue : optionnels (humain).
Ordre conseillé : splash (0:00) → capture perfect (0:08) → marchand + Why this price + 2ᵉ marchand plus cher (0:20) → forge → ticket →
playground (0:45) → Pulse + faillite/sauvetage (1:10) → Lab flood (1:30) → archi (1:50) → slogan + URL (2:10).
