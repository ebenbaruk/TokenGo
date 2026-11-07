# Soumission — tout est prêt, il ne reste que les gestes humains

Track : **`games` uniquement** (le propriétaire a vérifié avec l'organisateur : pas `agents`).
Deadline : **2026-11-14 23:59 UTC** (viser avant 18:00 UTC). Démo en ligne au moins jusqu'au **18/11**, idéalement **25/11**.
Critère écrit du track : *« Judged on the game loop, not the token — bonus if players never notice the chain. »*
Règles : https://nearhackathon.com/HACKATHON.md (relire juste avant d'envoyer).

## Checklist (≈ 45 min en tout)
1. **Héberger la démo (Railway, ~15 min).** railway.com → New Project → Deploy from GitHub repo → `ebenbaruk/TokenGo`
   (le `Dockerfile` et `railway.json` sont détectés). Puis :
   - Service → *Volumes* → ajouter un volume monté sur **`/data`** (la base SQLite y vit).
   - Service → *Settings* → *Networking* → **Generate Domain** (HTTPS, nécessaire au GPS) → noter l'URL `https://….up.railway.app`.
   - Service → *Variables* : coller (générer chaque secret avec `openssl rand -base64 32`) :
     ```
     NODE_ENV=production
     PUBLIC_URL=https://<ton-domaine>.up.railway.app
     TRUST_PROXY=1
     MASTER_KEY=<openssl>      SESSION_SECRET=<openssl>      SPAWN_SECRET=<openssl>
     DEMO_TOKEN=<openssl>      ADMIN_TOKEN=<openssl>
     ```
     + recopier depuis ton `.env` local les variables `NEAR_*` (chaîne testnet ; sans elles le jeu marche, sans preuves on-chain)
     et, si tu as fait l'étape 2, `NEARAI_*` + `FEATURE_REAL_CREDITS=1`.
   - Vérifier : `https://<domaine>/healthz` → `"ok":true,"invariantOk":true`. Ouvrir le site sur ton iPhone.
   - Coût : ~5 $/mois (plan Hobby) ; garder en ligne jusqu'au 25/11.
2. **(Recommandé) Crédits réels NEAR AI** : `Docs/HUMAN-TODO.md` 1–3 (compte mainnet + ~10 € de crédits), puis en local
   `node apps/server/scripts/nearai-spike.ts` (< $0.001). Sans ça, la démo publique tourne en crédits *simulés* (jouable, badge « sim »).
3. **Rendre le repo public** : GitHub → Settings → Change visibility → Public. Puis `git tag hackathon-submission && git push --tags`.
4. **Post X** : texte ci-dessous + la vidéo `docs-assets/video/tokengo-demo.mp4` (ou la version portrait). Publier, copier le lien du post.
5. **Soumettre** :
   ```bash
   cp scripts/submission.example.json var/submission.json   # remplir leadName, email, nearAddress (mainnet), demoUrl (lien du post X),
                                                            # playUrl + judgeLink (URL Railway + ?demo=1&k=<DEMO_TOKEN>), consent: true
   node scripts/submit.ts          # valide et affiche le JSON exact (n'envoie rien)
   node scripts/submit.ts --send   # envoie ; 201 = « Submission saved »
   ```
   `consent: true` signifie : *« I agree that the organizers may use these details to review our submission and contact us about this hackathon. »*
   Le texte `idea` est dans `scripts/submission-idea.txt` (≈ 1 600 car., le lien de jeu et le pass juges sont ajoutés à la fin).
   Corrections après envoi : https://nearhackathon.com/request-changes.

Règle Q-015 : si tu soumets un **autre** projet à ce même hackathon, chaque README doit nommer l'autre (2 max).

## Post X (l'humain publie)
```
I built a game where the loot is real AI compute 🗺️⚡

TokenGo: walk your city, catch shards of Claude, GPT, DeepSeek, Gemini & Qwen, haggle with AI shopkeepers whose prices follow real supply & demand, then forge them into a real AI API key.

Built at NEAR HACKATHON #NEARHackathon @NEARProtocol
▶️ <URL Railway> · 💻 github.com/ebenbaruk/TokenGo
```
(≤ 280 caractères hors liens courts ; joindre la vidéo. @NearLegion / @NearBuilders facultatifs.)

## Ce que voient les juges (≈ 5 min)
Laptop → le jeu s'ouvre dans un cadre de téléphone, Remote Scout par défaut. Pass juges `?demo=1&k=…` → compte niveau 7, sac plein :
capture PERFECT + combo → bulles des marchands → marchandage → Forge → ticket de crédit → playground ; `/pulse` et `/lab` sans compte.
Pistes de l'IA de tri (Claude Code / Codex) : `npm install && npm run verify` (sans secret) → tests + build + e2e.
