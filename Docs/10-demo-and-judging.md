# 10 — Démo, jugement & soumission

## 1. Comment on est jugé
1. **Tri par Claude Code & Codex** (Q-017) : ils clonent le repo, suivent le README, lancent le projet, vérifient que chaque fonctionnalité
   annoncée existe. → Le projet doit **tourner en local sans aucun secret** (`FEATURE_REAL_CREDITS=0`, chaîne désactivée) et le README doit avoir
   des étapes « Do X → See Y » vérifiables, y compris par script (`npm run verify` qui exécute les tests + un scénario e2e headless).
2. **Jury humain** : regarde la vidéo du post X, ouvre la démo hébergée, lit le README. Critères probables : implémentation technique,
   design, impact, originalité, durabilité ; pour la track : **la boucle de jeu**, bonus si la chaîne est invisible.

## 2. README (anglais, écrit pour une IA et un humain, sans marketing)
Plan imposé :
1. **What it is** (3 lignes) + GIF de 6 s (capture → trade → forge).
2. **Live demo** : URL HTTPS + « Play as guest » + lien `/pulse` et `/lab` (pas de compte requis).
3. **The problem / why it's a game with a real economy** (5 puces factuelles).
4. **Try it in 5 minutes (no secrets needed)** : `npm install && npm run dev` → numbered « Do X → See Y » :
   1. Open http://localhost:5173/?demo=1 → see the Paris map with your avatar at the Louvre.
   2. Tap the glowing shard 20 m away, tap when the ring hits the target → see « +1 DeepSeek Shard ».
   3. … (relay, merchant + « Why this price? », forge First Compile → simulated credits, playground)
   4. Open /lab → click « Simulate 1 week » with scenario « Flood DeepSeek » → see DeepSeek mid price fall at merchants and 2+ merchants close.
   5. Run `npm test` → see N tests pass (economy invariants, anti-cheat, pricing).
5. **How NEAR is used** (concret) : NEP-245 contract (lien explorer testnet + méthodes), un compte NEAR par joueur et par marchand (custodial,
   assumé), settlement par lots + burn avant tout crédit réel, NEAR AI Cloud (crédits réels par clé à plafond, cerveau des marchands, TEE),
   NEAR Intents (devis dry-run pour « Fund the city »).
6. **Economy rules** : lien vers `packages/shared/src/economy/rules.ts` + résumé des formules.
7. **Security & anti-cheat** : résumé + limites honnêtes.
8. **Architecture** : schéma ASCII + arborescence.
9. **Run with real credits/chain** : variables d'env (`.env.example`), étapes.
10. **Hackathon disclosure** : construit du 2026-11-06 au 2026-11-14 pendant NEAR HACKATHON ; libs utilisées ; code assisté par IA ;
    pas d'autre projet soumis par l'auteur (sinon le nommer, Q-015).
11. **License** MIT.

## 3. Comptes de démo
- `?demo=1` : Remote Scout (pigeon-drone à batterie, ex-Demo Walk), bouton principal « Remote Scout ». Départ : Louvre (Cour Napoléon) — Forge du Louvre à ~150 m, 2 marchands à < 500 m,
  éclats garantis autour (le tutoriel les place).
- **Guest** : peut tout faire ; crédits réels via la First Compile ($0.03, Welcome Pool, après capture + sync + trade) puis le **Judge Pool** du 16 au 18 nov → les juges
  voient une **vraie** clé fonctionner même si le Welcome Pool a été consommé.
- `DEMO_TOKEN` (env) : `/?demo=1&k=<token>` donne un compte démo niveau 7 avec inventaire pour montrer Prism/Aura et le patronage
  en 1 minute (crédits réels pris dans le Judge Pool, $0.20 max par compte ; ces comptes ne peuvent pas vendre aux marchands ; 1 usage/IP/jour).

## 4. Vidéo (≤ 2 min 30, script)
| Temps | Plan |
|---|---|
| 0:00 | Rue de Paris réelle, téléphone en main : « What if the loot in a Pokémon-Go-style game was real AI compute? » (sans montrer de Pokémon) |
| 0:08 | Écran : carte cartoon colorée, éclats en pixel art ; capture d'un Claude Shard (perfect) |
| 0:20 | Marchand : tooltip « Why this price? » ; vente ; puis 2ᵉ marchand à ~500 m (Jump) où le même éclat vaut +40 % → « walking is arbitrage » |
| 0:45 | Forge du Panthéon : recette Prism → animation → ticket « +$0.06 » → Playground : question à Claude avec ses propres crédits |
| 1:10 | Pulse : ticker en direct, un marchand en faillite, réouvert par des patrons ; liens explorer NEP-245 |
| 1:30 | Lab : « Simulate 1 week », scénario flood, prix qui chutent, faillites |
| 1:50 | Architecture en 1 écran : NEP-245 · un compte NEAR par joueur/marchand · NEAR AI Cloud (TEE) · invariant de Réserve |
| 2:10 | « Walk Paris. Catch AI. Spend it for real. » + URL + repo |
Tournage : captures d'écran via Playwright (écran mobile) + quelques plans réels en extérieur filmés par l'humain (optionnel).
Préparer les images clés automatiquement (`npm run shots` → `docs-assets/`).

## 5. Post X (brouillon à faire valider ; l'humain publie)
```
What if Pokémon-Go-style loot was real AI compute? 🗺️⚡

TokenGo: walk Paris, catch shards of Claude, GPT, DeepSeek, Gemini & Qwen, trade them with AI merchants
(each runs its own NEAR wallet & sets prices from supply/demand), then forge them into real NEAR AI Cloud
credits on your own API key. No wallet, no seed phrase, no gas.

Built at #NEARHackathon @NEARProtocol @NearBuilders
▶️ Play: <url>  · Code: <repo>
Which Paris landmark should be the next Forge?
```

## 6. Soumission (procédure HACKATHON.md, **jamais sans OK explicite de l'humain**)
- Champs à demander à l'humain (ne jamais inventer) : projectName (« TokenGo »), leadName, email, size `1`, tracks `["games","agents"]`,
  nearAddress (mainnet, à lui), projectUrl (repo public), demoUrl (post X), idea (20–2000 caractères — brouillon préparé), consent.
- Générer `requestId` une fois (`node -e 'console.log(crypto.randomUUID())'`), le garder dans `var/submission-request-id` (non commité).
- Afficher le JSON complet, attendre « oui », `POST https://nearhackathon.com/api/applications`. 201 = fini. Ne jamais resoumettre ; erreurs
  → https://nearhackathon.com/request-changes. Ne pas envoyer le champ `website` (piège à spam).
- Relire https://nearhackathon.com/HACKATHON.md juste avant (les règles peuvent changer).
- Garder la démo en ligne jusqu'au **2026-11-25**.
