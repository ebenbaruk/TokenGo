# Ce que seul l'humain peut faire

Claude avance sans attendre grâce aux modes dégradés (crédits simulés, chaîne désactivée, invité seul). Chaque action ci-dessous
débloque la version « réelle ». Cocher quand c'est fait et mettre les valeurs dans `TokenGo/.env` (jamais dans le chat si possible).

## Bloquant pour les crédits réels (à faire en premier, ~30 min)
- [ ] **1. Compte NEAR mainnet dédié au jeu** (ex. `tokengo-ai.near`, ou un compte implicite) dans un wallet (Meteor, HOT, MyNearWallet…).
      Il doit **exister on-chain** (un peu de NEAR pour le créer, ~0,1 NEAR suffit). Il ne gardera presque pas de fonds.
      Exporter sa **clé privée full-access** (`ed25519:…`) → `.env` : `NEARAI_AUTH_ACCOUNT=…` et `NEARAI_AUTH_KEY=ed25519:…`.
      Pourquoi : NEAR AI Cloud n'autorise la création de clés API que via une session obtenue en signant avec ce compte.
- [ ] **2. Se connecter sur https://cloud.near.ai avec ce compte** (même compte que 1), puis **acheter ~10 € de crédits**
      (section Credits ; crypto via HOT Pay, ou carte si proposée).
- [ ] **3. Réclamer les $10 offerts** en rejoignant NEAR Builders : https://nearbuilders.org/join (probablement un code coupon à saisir sur
      cloud.near.ai). Ça double la Réserve gratuitement.
- [ ] (Claude récupère lui-même `NEARAI_ORG_ID` / `NEARAI_WORKSPACE_ID` via l'API une fois 1 fait.)

## Bloquant pour la démo publique HTTPS (~10 min)
- [ ] **4. Tailscale** : dans https://login.tailscale.com/admin/dns activer **HTTPS Certificates**, et dans la policy du tailnet autoriser
      **Funnel** pour la machine `surface` (attribut `funnel`). Claude lancera ensuite `tailscale funnel` sur le port du jeu.
      (Alternative : créer un compte Fly.io avec carte, ~$5/mois — Claude a le Dockerfile prêt.)
- [ ] **5. Google OAuth** (après 4, il faut l'URL HTTPS finale) : https://console.cloud.google.com → nouveau projet « TokenGo » →
      OAuth consent screen *External*, scopes `openid email profile`, **publier en Production** → Credentials → OAuth client ID *Web* →
      redirect URI `https://<url-finale>/auth/google/callback` (+ `http://localhost:8787/auth/google/callback`) →
      `.env` : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Sans ça, le jeu marche en invité.

## Pour la soumission (J8)
- [ ] **6. Compte NEAR mainnet pour recevoir le prix** (peut être ton compte perso, différent de 1).
- [ ] **7. Repo GitHub** : créé en **privé** le 2026-11-06 → https://github.com/ebenbaruk/TokenGo. Reste : le **rendre public** avant le 14/11 23:59 UTC (avec ton OK).
- [ ] **8. Vidéo + post X** : Claude prépare le script, les captures et le texte ; tu filmes (optionnel : quelques plans dans la rue) et tu publies.
- [ ] **9. Valider la soumission** : Claude affiche le JSON exact, tu dis « oui ».

## Facultatif
- [x] Référence design reçue (pixel art coloré) → DA « Pixel Pop Paris » dans `09-ux-ui-design.md`. D'autres refs bienvenues dans `Docs/design-ref/`.
- [ ] Tester sur ton iPhone en marchant dans Paris (après 4) et noter ce qui ne va pas.
