# 01 — Vision & pitch

## En une phrase
**TokenGo transforme Paris en mine de calcul : tu marches, tu captures des éclats d'IA, tu les échanges avec des
marchands IA qui ont leur propre wallet et fixent leurs prix eux-mêmes, et tu les forges en vrais crédits pour
Claude, GPT, DeepSeek, Gemini ou Qwen — utilisables tout de suite avec ta propre clé API.**

## Pitch (pour README, vidéo, post X — en anglais)
> Walk Paris. Catch AI. Spend it for real.
> TokenGo is a location-based browser game where the loot is real AI compute. Shards of Claude, GPT, DeepSeek,
> Gemini and Qwen spawn around you. AI merchants — each with its own NEAR wallet — buy and sell them at prices that
> follow real supply and demand, so the same shard is cheap at Bastille and expensive at the Louvre. Walk the spread,
> fill a Forge recipe, and compile it into real NEAR AI Cloud credits on your own API key. No wallet, no seed phrase,
> no gas: just sign in and walk.

## Pourquoi ça gagne la track `games`
Critères officiels : *« Judged on the game loop, not the token — bonus if players never notice the chain »*,
pistes : **Agent NPCs, social login, NEAR Intents, NEP-245**, et le prompt d'exemple exige marchands-agents à wallet,
prix offre/demande, faillite + réinvestissement, règles lisibles + raisonnement en tooltip, mode avance rapide.

| Ce que veulent les juges | Notre réponse |
|---|---|
| Boucle de jeu forte | 3 boucles imbriquées : 30 s (capturer), 5 min (relais / marchand / contrat), session (forger, investir, défendre son arrondissement). Voir `02-game-design.md`. |
| « The economy is the gameplay » | **Le déplacement physique EST l'arbitrage** : chaque marchand a son stock, donc ses prix ; marcher d'un quartier à l'autre = profiter de l'écart. Recettes de forge qui tournent chaque jour = chocs de demande. |
| NPC avec wallets | Chaque marchand = un compte NEAR testnet + une personnalité IA (NEAR AI Cloud) qui ajuste sa stratégie dans des bornes. |
| Économie qui évolue sans patch | Prix de référence qui dérivent, faillites, réouvertures par les joueurs, Réserve qui pilote l'émission. |
| Marchés possédés par les joueurs | Sauvetage : les joueurs renflouent un marchand en faillite → il rouvre, le Patron a son nom sur le nœud et de meilleurs prix. Des runners-agents font vivre le marché en continu. |
| NEP-245 | Un seul contrat multi-token pour tous les objets (5 familles d'éclats + Flux). |
| Social login, pas de popup | Google ou invité, compte NEAR créé et signé par le serveur, gas invisible. |
| Avance rapide | **Economy Lab** : 200 bots, 7 jours simulés en ~10 s, graphiques en direct, scénarios « inonder le marché ». |
| Récompense réelle et cohérente avec NEAR | Les gains sont des **crédits NEAR AI Cloud** (inférence privée en TEE) — le produit phare de NEAR AI. |

Track secondaire : `agents` (marchands qui gagnent, dépensent, négocient). Soumettre aux deux.

## Principes de design (non négociables)
1. **Fun d'abord, chaîne invisible.** Le mot « blockchain » n'apparaît jamais dans la boucle de jeu. Il apparaît
   seulement dans « Preuves » (liens explorer) et dans le profil.
2. **Premier crédit réel en moins de 3 minutes** (mode démo) — c'est le moment « wow » de la vidéo.
3. **Le monde réel compte** : les éclats suivent les lieux (bibliothèques, gares, parcs…), les prix suivent le quartier.
4. **Solvable par construction** : on ne promet jamais plus que la Réserve (10 €). Chaque centime payé est prouvé on-chain.
5. **Paris d'abord, partout ensuite** : rien n'est codé en dur pour Paris ; Paris est un jeu de données soigné
   (Forges iconiques, arrondissements) et le reste du monde utilise le générateur générique.

## Hors périmètre (assumé)
App native, combat PvP, NFT d'avatars, mainnet pour les objets, paiement en carte, multi-langue complet (UI en anglais,
quelques touches françaises de flavor), comptes non-custodiaux (export prévu en stretch).
