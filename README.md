# TokenGo — Walk Paris. Catch AI. Spend it for real.

![TokenGo](docs-assets/cover.jpg)

▶️ **Demo video (83 s):** [`docs-assets/video/tokengo-demo.mp4`](docs-assets/video/tokengo-demo.mp4) · portrait: [`tokengo-demo-portrait.mp4`](docs-assets/video/tokengo-demo-portrait.mp4)

**TokenGo is a location-based browser game where the loot is real AI compute.** Shards of Claude, GPT, DeepSeek, Gemini and Qwen
spawn around real landmarks. AI shopkeepers buy and sell them at prices driven by local supply and demand, so the same shard is cheap
at one café and expensive near the Louvre. Walk the spread, haggle, fill a Forge recipe, and compile it into **real NEAR AI Cloud
credits on your own API key**. No wallet, no seed phrase, no gas: just play. Paris is the hand-built showcase city; anywhere else the
server maps your neighbourhood from OpenStreetMap on the fly.

**Problem it solves.** Location games reward walking with loot that is worth nothing outside the app, and "play-to-earn" games that pay
real value usually go insolvent. TokenGo pays in something people actually use (LLM inference) through a single, capped door, so the
game is solvent by construction and the loot is useful the day you earn it.

Built for the NEAR HACKATHON — track **games**.

| | | | |
|---|---|---|---|
| ![](docs-assets/shots/living-03-bubbles.png) | ![](docs-assets/shots/juice-01-combo-lock-on.png) | ![](docs-assets/shots/haggle-02-rival.png) | ![](docs-assets/shots/07-credit-ticket.png) |
| Living map (Remote Scout) | Lock-on catch + combo | Haggling card game | Real credit ticket |
| ![](docs-assets/shots/05-merchant-why.png) | ![](docs-assets/shots/juice-04-codex.png) | ![](docs-assets/shots/living-04-event-map.png) | ![](docs-assets/shots/lab-01-flood.png) |
| "Why this price?" | Shard Codex (25 variants) | City event: flash crash | Economy Lab |

---

## Try it
### Hosted demo
- **Play:** _(URL added at deploy time)_ → **Play for real** (GPS, works in any city) or **Remote Scout** (no GPS: fly a
  battery-limited courier pigeon over Paris from your couch — the game is meant to be walked, this mode lets you try it anywhere).
  On a laptop the game opens in a phone frame and Remote Scout is the default.
- **Judges' pass:** `/?demo=1&k=<DEMO_TOKEN>` (link in the submission) → a level-7 Remote Scout account with a full bag, to see
  Prism/Aura compiles, haggling and merchant rescues in a few minutes, paid in **real** credits from the Judge pool ($0.20 max per account).
- **City Pulse** (`/pulse`, no account): live ticker, active city event, walkers, Paris Shard Index, reserve, on-chain settlements.
- **Economy Lab** (`/lab`, no account): simulate a week of Paris with 200 bots in under a second, with the exact live rules.

### Locally in 5 minutes (no secrets needed)
Requirements: Node ≥ 24, npm 11.
```bash
npm install
npm run build          # builds the web app (served by the server)
npm run dev            # web http://localhost:5173 + API :8787 (credits simulated, chain off without .env)
```
1. Open **http://localhost:5173/?demo=1** → **Remote Scout** → your pigeon lands at the Louvre with a starter kit; Margot, a merchant,
   guides you in 5 one-line bubbles. Tap the map (or the big **Fly there** button) to fly; the battery recharges over time.
2. A glowing **DeepSeek shard** is next to you: tap **Catch**, then tap when the shrinking ring hits the dashed circle → see the variant
   reveal (Classic / Night / Landmark / Overclocked / Shiny) and the combo flame on PERFECTs. Bag › Codex shows your collection.
3. Fly to a **Relay** (fountain icon) → swipe the disc → Flux + a shard.
4. Fly to **Le Café Marly** (market stall; merchants shout their state in speech bubbles) → ⓘ **Why this price?** shows the exact formula
   → buy 3+ shards → **Haggle**: play cards against the merchant's personality; "Your rival pays more" only works if it is *true*.
5. Fly to the **Louvre Forge** → **First Compile** → hold → a credit ticket: **+$0.030 · ≈ 20 DeepSeek chats** (marked *simulated* without a
   NEAR AI account) → **Share** makes a PNG card → **Try it now** → Playground → ask a question with your own key.
6. The **Route** chip (bottom left) is today's Daily Route: 3–5 real stops nearby, same for everyone in the neighbourhood.
7. Open **/lab** → scenario **DeepSeek flood** → **Simulate 1 week** → compared with the same week without the flood (−49 % on DeepSeek).
8. Open **/pulse** → watch the live ticker while you trade in another tab. City events (flash crash, gold rush, forge hype, merchant
   strike) start on their own during the day, or with `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Origin: http://localhost:5173" localhost:8787/api/admin/event`.
9. `npm test` → **211 unit tests** (economy invariants, haggling bounds, anti-cheat, pricing exploits, regions, API, chain settler, NEAR AI request shapes).
10. `npm run verify` → tests + typecheck + build + headless e2e of the whole loop; `npm run e2e` runs all **28 flows** on a mobile viewport.

Other commands: `npm run sim -- --days 7 --players 200 --scenario flood-deepseek --seed 42` (economy simulator CLI, health checks),
`npm run shots` (screenshots), `npm run video` (re-records the demo video with Playwright + ffmpeg), `npm run reconcile` (chain vs DB), `npm run check:secrets`.

## The game loop
- **Walk (or scout).** Real GPS anywhere: outside Paris the server builds a region from OpenStreetMap around you (relays on real POIs,
  shops on real cafés, forges on landmarks), with a deterministic procedural fallback while Overpass answers. Remote Scout is the
  explained couch mode: server-enforced speed and battery.
- **Catch.** Lock-on timing mini-game, combos, haptics, 25 cosmetic variants in the Codex (night, landmark, shiny…).
- **Trade.** Every merchant has its own stock, so its own prices: walking is arbitrage (15–40 % gaps 600 m apart). Speech bubbles show
  real state ("Closing soon… help!"). **Haggling** is a 3-round card game bounded to ±8 % and never below the merchant's cost floor.
- **Live city.** 24 runner-agents walk the map and trade around the clock; real players appear as anonymous walkers (cell-level only);
  server-wide **city events** move prices and spawns for 20–40 minutes; merchants go bankrupt and get rescued by players (Patrons).
- **Come back.** Daily Route with streaks, daily Forge recipes, Codex completion, share cards.
- **Forge.** The only door to real value: burn shards from several families/places → raise the spend limit of your own NEAR AI Cloud API key.

## How NEAR is used
| Piece | What | Where |
|---|---|---|
| **NEP-245 multi-token** | One homemade contract for every item: `flux`, `shard:deepseek`, `shard:qwen`, `shard:gemini`, `shard:gpt`, `shard:claude`. Standard views + transfers, operator batch methods, idempotent `op_settle(ops, settlement_id)`, aggregated `EVENT_JSON` NEP-245 events. | [`contracts/tokengo-mt`](contracts/tokengo-mt) · deployed on **`tokengo.testnet`** ([explorer](https://testnet.nearblocks.io/address/tokengo.testnet)) |
| **An account per player and per merchant** | Sub-accounts `p-…`/`m-…`/`r-….tokengo.testnet`, created lazily, keyless (custodial by the game operator — stated honestly; "export my account" is a planned stretch). | `apps/server/src/chain/accounts.ts` |
| **Settlement** | Every value move is written to an outbox in the same SQLite transaction, then settled in batches every 8 s. **Before any real credit is granted, the Forge burn is settled on-chain** and its tx is shown as *Burn proof ↗*. Reconcile job compares on-chain balances with the DB. | `apps/server/src/chain/settler.ts`, `reconcile.ts` |
| **Proofs** | Profile › Proofs: your account on the explorer, your settled ops, and **"Verify on-chain"** which calls `mt_batch_balance_of` from your browser. | web `Proofs` |
| **NEAR AI Cloud — real credits** | The game holds a NEAR AI organisation (session obtained by **NEP-413** signature). Each player gets their own API key with a `spendLimit`; Forge payouts raise that limit. Solvency invariant checked before every grant: `Σ(limit − usage) + overshoot × keys + NPC budget + safety ≤ org balance`. | `apps/server/src/nearai/`, `game/reserve.ts` |
| **NEAR AI Cloud — merchant brains** | Merchants think with a cheap TEE model (`z-ai/glm-5.3-flash`), JSON schema output, clamped, ≤ 150 calls/day, deterministic fallback. | `nearai/brain.ts`, `economy/agent.ts` |
| **Private inference** | Playground models include TEE-verifiable ones (badged). | Credits screen |

The words *blockchain, wallet, gas, transaction* never appear in the game loop — only in Proofs and Pulse › On-chain.

## Economy rules (one readable file)
All constants live in [`packages/shared/src/economy/rules.ts`](packages/shared/src/economy/rules.ts); formulas are pure functions next to
it (`pricing.ts`, `market.ts`, `forge.ts`, `reserve.ts`, `spawns.ts`, `agent.ts`), shared by the server, the simulator and the UI.
- **Price:** `mid = P0 × clamp((target/stock)^1.1, 0.35, 3)`; buy/sell = `mid × (1 ∓ spread)`, each unit valued at the stock *after* the
  trade → buying then selling back always loses (tested on 500 random draws).
- **Merchant life (hourly):** imports when low (Flux sink), the city buys surplus (income that scales with activity), rent only when
  active; till < 150 ƒ → *closing* (2 h) → *closed*; players rescue it back to 600 ƒ → reopens, top contributor becomes Patron.
- **Reference price:** `P0` drifts toward `P0₀ × median scarcity` (Paris Shard Index), bounded to 0.6–1.4 × P0₀.
- **Forge payout:** `min(pool × 0.4 % × weight, player cap $0.25/24 h, city cap 5.5 %/day)` → geometric decay, never zero.
- **Health targets** (checked by the simulator and a test): merchant prices within 0.6–1.8 × P0, ≥ 15 % price gap between nearby
  merchants, ≥ 10 % of merchants struggle in a week but ≤ 30 % closed, Main pool drains ≤ 35 %/week.
Full design: [`Docs/03-economy.md`](Docs/03-economy.md).

## Security & anti-cheat (and honest limits)
- Server-authoritative: the client only sends intents. Spawns are deterministic (`HMAC(secret, cell, window)`) and recomputed server-side;
  quotes are single-use and bound to the merchant version (`PRICE_MOVED`); catches are keyed `(user, spawn)`.
- Movement: rolling 60 s speed → *in transit* (actions paused); impossible jumps → soft-lock + flag; action distance re-checked
  server-side; proof of walk (1.5 km) for Google accounts before the Main pool.
- Money: guests get one $0.03 First Compile (global cap 4/hour); only judge passes (`DEMO_TOKEN`, one per IP per day, cannot sell)
  draw from the Judge pool; Google accounts need 1.5 km of proof of walk for the Main pool; compiles are serialized per player and
  grants reserved inside the burn transaction (no double-spend under concurrency); per-player/day/city caps; kill switch
  `POST /api/admin/forge/pause`.
- Web: Origin check on every write, `SameSite=Lax` HttpOnly session cookie, strict CSP, rate limits per route, daily quotas,
  keys encrypted at rest (AES-256-GCM), no free-text input ever reaches the merchant LLM.
- **Limits:** browser GPS can be spoofed; we bound what cheating earns rather than pretend to stop it. Player NEAR accounts are custodial.

## Architecture
```
 Browser (React + MapLibre, pixel sprites drawn from text grids, Web Worker simulator)
   │  JSON + SSE (same origin)
 Fastify server (Node 24, TypeScript, 1 process) ── SQLite (WAL) ── outbox ──► settler ──► NEP-245 contract (NEAR testnet)
   │                                                                 
   ├─ shared pure economy rules (packages/shared) — also used by the simulator & UI
   ├─ runner-agents + merchant reflections (jobs)
   └─ NEAR AI Cloud: NEP-413 session → per-player API keys (spendLimit) · merchant brain · playground relay
```
```
apps/web        React app (map, screens, Lab, Pulse, Proofs)       apps/server   Fastify API, game logic, chain, NEAR AI
packages/shared types + economy rules + simulator                  contracts/tokengo-mt   NEP-245 contract (Rust)
data/world      Paris nodes built from OpenStreetMap               e2e/          Playwright specs     Docs/  full spec
```

## Run with real credits and chain
Copy `.env.example` to `.env`:
- **Chain:** `NEAR_CONTRACT_ID`, `NEAR_OPERATOR_ID`, `NEAR_OPERATOR_KEY` (testnet) → settlement on.
- **Real credits:** `NEARAI_AUTH_ACCOUNT` + `NEARAI_AUTH_KEY` (a mainnet account's full-access key, used only to sign NEP-413 login
  messages) → `node apps/server/scripts/nearai-spike.ts` checks everything for < $0.001.
- `MASTER_KEY` (32 bytes base64), `SESSION_SECRET`, `SPAWN_SECRET`, `TRUST_PROXY` (proxy hops, 1 on Railway/Fly), optional `GOOGLE_CLIENT_ID/SECRET`, `DEMO_TOKEN`, `ADMIN_TOKEN`.

**Deploy:** `Dockerfile` + `railway.json` (one container, SQLite on a volume at `/data`). HTTPS is required for browser geolocation.
Serverless hosts (e.g. Vercel functions) don't fit: the game needs a persistent SQLite file, background jobs and SSE.

## Hackathon disclosure
- **Built during the hackathon, from scratch:** first commit 2026-11-06 (spec only), all code written between 2026-11-06 and 2026-11-14.
  There is no pre-hackathon code and no existing product on another chain. The submitted state is tagged `hackathon-submission`.
- **AI-generated code:** most of the code, tests and docs were written with AI coding agents (Claude Code, Anthropic) under the
  direction of the solo developer; the full design spec and every decision are in [`Docs/`](Docs/00-INDEX.md). Splash, logo, cover and
  icons were generated with an image model (Codex imagegen); the in-game pixel sprites are hand-written text grids in `apps/web/src/sprites/`.
- **Data:** map data © OpenStreetMap contributors (ODbL), tiles © OpenFreeMap / OpenMapTiles.
- **Libraries:** React, React DOM, Vite, MapLibre GL, Zustand, Motion, clsx, lucide-react, @fontsource (Pixelify Sans, Nunito), Fastify
  (+ @fastify/cookie, rate-limit, static), better-sqlite3, zod, h3-js, near-kit, @noble/hashes, @noble/curves, arctic;
  contract: near-sdk (Rust), cargo-near; tooling: TypeScript, Vitest, Playwright, sharp, ffmpeg. No game template was used.

## License
MIT
