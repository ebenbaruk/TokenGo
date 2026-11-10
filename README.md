# TokenGo — Walk your city. Catch AI. Spend it for real.

![TokenGo](docs-assets/cover.jpg)

<p align="center">
<b><a href="https://tokengo-production-195c.up.railway.app">▶️ Play now</a></b> ·
<b><a href="https://tokengo-production-195c.up.railway.app/?demo=1&k=adXQaIwuy-CPqn8UVfJihkuZ6IKIl-AaFz00ShZIjZo">🎟 Judges' pass (level 7, full bag)</a></b> ·
<a href="docs-assets/video/tokengo-demo.mp4">🎬 Demo video (76 s)</a> ·
<a href="https://tokengo-production-195c.up.railway.app/pulse">📈 City Pulse</a> ·
<a href="https://tokengo-production-195c.up.railway.app/lab">🧪 Economy Lab</a> ·
<a href="https://testnet.nearblocks.io/address/tokengo.testnet">⛓ Contract on NEAR</a>
</p>

> **TokenGo is a location-based browser game where the loot is AI compute.**
> Shards of **Claude, GPT, DeepSeek, Gemini and Qwen** spawn around real places. AI shopkeepers buy and sell them at prices
> driven by their own stock, so the same shard is cheap at one café and expensive near the Louvre. You walk the spread,
> haggle, complete a Forge recipe at a monument, and compile it into **inference credits on your own NEAR AI Cloud API key**.
> Every item is a **NEP-245 token on NEAR**, every compile **burns its shards on-chain**, and the player never sees a
> wallet, a seed phrase or a gas fee.
>
> And your shards are not just loot: **each family is an AI model with a fighting style**. Catching a rare one means
> *predicting the next token*; you field 3 models in tactical **Model Arena** battles (Math, Code, Writing, Vision, Speed,
> Languages — pick the right model *and* the right prompting technique), take a monument as its **Champion**, and team up with
> the whole city when a **Rogue Model** breaks loose.

Built from scratch for the **NEAR HACKATHON**, track **`games`**: *"Judged on the game loop, not the token — bonus if players
never notice the chain."* That sentence is the design brief of this whole repository.

> [!NOTE]
> **🧪 Demo season.** For the hackathon, the public server runs with **simulated AI credits**, so anyone can play the whole
> loop for free, for as long as they like. **Everything else is live**: the world, merchants, prices, city events, runner bots,
> and **the NEAR side — items are minted, moved and burned on `tokengo.testnet`, with explorer links in the game**.
> The real-credit pipe (NEP-413 login to NEAR AI Cloud, one API key per player, spend limit raised by the Forge, solvency
> invariant) is **fully built and unit-tested** in [`apps/server/src/nearai/`](apps/server/src/nearai) and
> [`game/reserve.ts`](apps/server/src/game/reserve.ts); it is switched on by environment variables once the city reserve
> is funded. See [Demo season → real credits](#-demo-season--real-credits).

---

## Contents
1. [TokenGo in 30 seconds](#-tokengo-in-30-seconds)
2. [Judge it in 5 minutes](#-judge-it-in-5-minutes)
3. [Why this game should exist](#-why-this-game-should-exist)
4. [The game loop, in depth](#-the-game-loop-in-depth)
5. [The economy: a living market you can read](#-the-economy-a-living-market-you-can-read)
6. [How NEAR is used (and hidden)](#-how-near-is-used-and-hidden)
7. [Demo season → real credits](#-demo-season--real-credits)
8. [Play anywhere on Earth](#-play-anywhere-on-earth)
9. [Security, anti-cheat and solvency](#-security-anti-cheat-and-solvency)
10. [Art direction, UX and game feel](#-art-direction-ux-and-game-feel)
11. [Architecture](#-architecture)
12. [Quality: how we know it works](#-quality-how-we-know-it-works)
13. [Run it yourself](#-run-it-yourself)
14. [Roadmap](#-roadmap)
15. [Hackathon disclosure](#-hackathon-disclosure)

---

## ⚡ TokenGo in 30 seconds

| | |
|---|---|
| **Genre** | Location-based collect / trade / **battle** game (walk → catch & decode → trade → fight → craft), browser only, mobile first |
| **Hook** | The loot is something people actually use every day: LLM inference |
| **Core twist** | Every shop has its own stock, so its own price: **walking is arbitrage** |
| **Combat** | **Model Arena**: 3v3 tactical battles at monuments with real LLM categories, prompting techniques (Chain-of-thought, Few-shot, Tool use, High temperature), token budgets, rate limits and hallucinations. Win → become the arena's **Champion** (crown on the map) |
| **Catch with a brain** | Rare and epic shards must be **decoded**: predict the next token in 4 s, or the shard "hallucinates" and may flee |
| **Co-op** | **Rogue Model raids**: a glitched AI boss appears at a Forge, the whole city drains one live HP bar together |
| **Daily hooks** | 3 daily missions + chest, Daily Route, per-family **Mastery** (levels 1–10), **"Who holds the city"** district rivalry |
| **Where** | Paris is the hand-built showcase (1 060 relays, 153 shops, 10 monument Forges, all from OpenStreetMap). **Anywhere else**, the server maps your neighbourhood live |
| **No GPS? No problem** | **Remote Scout**: fly a battery-limited courier pigeon over Paris from your couch |
| **Onboarding** | One tap, no sign-up, no wallet. A guest account exists in under a second |
| **Chain** | Homemade **NEP-245** multi-token contract on NEAR testnet, batched idempotent settlement, burn-before-credit, verify-from-your-browser proofs |
| **AI** | **NEAR AI Cloud** for player API keys (NEP-413 login, per-key spend limits) and merchant "brains" (bounded, JSON-schema output) |
| **Liveness** | 24 runner bots trade around the clock, real players show up as anonymous walkers, city-wide events move prices for everyone |
| **Proof it works** | 292 unit tests, 36 end-to-end flows on a mobile viewport, contract tests, an economy simulator with health checks |

<table>
<tr>
<td><img src="docs-assets/shots/living-03-bubbles.png" width="200"/></td>
<td><img src="docs-assets/shots/juice-01-combo-lock-on.png" width="200"/></td>
<td><img src="docs-assets/shots/haggle-02-rival.png" width="200"/></td>
<td><img src="docs-assets/shots/07-credit-ticket.png" width="200"/></td>
</tr>
<tr><td>Living map: shops shout their state</td><td>Lock-on catch + combo flame</td><td>Haggling card game</td><td>Forge credit ticket + burn proof</td></tr>
<tr>
<td><img src="docs-assets/shots/05-merchant-why.png" width="200"/></td>
<td><img src="docs-assets/shots/juice-04-codex.png" width="200"/></td>
<td><img src="docs-assets/shots/living-04-event-map.png" width="200"/></td>
<td><img src="docs-assets/shots/lab-01-flood.png" width="200"/></td>
</tr>
<tr><td>"Why this price?": the real formula</td><td>Shard Codex: 25 variants</td><td>City event: flash crash</td><td>Economy Lab: a week in 1 s</td></tr>
<tr>
<td><img src="docs-assets/shots/scout-02-hud.png" width="200"/></td>
<td><img src="docs-assets/shots/anywhere-02-lisbon-live.png" width="200"/></td>
<td><img src="docs-assets/shots/juice-06-route-sheet.png" width="200"/></td>
<td><img src="docs-assets/shots/living-06-pulse.png" width="200"/></td>
</tr>
<tr><td>Remote Scout: the couch mode</td><td>Lisbon, generated live from OSM</td><td>Daily Route: same loop for the whole block</td><td>City Pulse: the city's dashboard</td></tr>
<tr>
<td><img src="docs-assets/shots/decode-01-card.png" width="200"/></td>
<td><img src="docs-assets/shots/arena-02-team.png" width="200"/></td>
<td><img src="docs-assets/shots/arena-04-reveal.png" width="200"/></td>
<td><img src="docs-assets/shots/arena-06-crown.png" width="200"/></td>
</tr>
<tr><td>Decode: predict the next token</td><td>Arena: pick 3 models (game stats)</td><td>Arena round: model × technique</td><td>You are now Champion</td></tr>
<tr>
<td><img src="docs-assets/shots/raid-01-map-banner.png" width="200"/></td>
<td><img src="docs-assets/shots/raid-04-hit.png" width="200"/></td>
<td><img src="docs-assets/shots/missions-04-ready.png" width="200"/></td>
<td><img src="docs-assets/shots/missions-07-city.png" width="200"/></td>
</tr>
<tr><td>Rogue Model loose at the Louvre</td><td>Raid assault: −19 HP</td><td>Daily missions + chest</td><td>Who holds the city</td></tr>
</table>

---

## 🎟 Judge it in 5 minutes

1. Open the **[judges' pass](https://tokengo-production-195c.up.railway.app/?demo=1&k=adXQaIwuy-CPqn8UVfJihkuZ6IKIl-AaFz00ShZIjZo)**
   (on a laptop the game opens inside a phone frame, with a QR code to continue on your phone) → **Remote Scout**.
   You land at the Louvre as a **level-7** runner with a full bag, so every tier of the game is unlocked.
2. **Catch.** Tap **Catch** on the glowing shard, then tap when the shrinking ring meets the dashed circle. PERFECT → combo flame,
   variant reveal (Classic / Night / Landmark / Overclocked / Shiny), XP. Chain two catches to see the combo grow.
   On a **GPT or Claude** shard, the lock-on is followed by **Decode**: complete the sentence with the right next token in 4 s.
3. **Fly.** Tap anywhere on the map, or the big **Fly there** button on an objective. The pigeon cruises at 30 km/h; its battery
   drains per km and recharges in real time. Walking is the real game; this mode lets you taste it from anywhere.
4. **Trade.** Open a shop (market stall). Read its speech bubble ("Need 5 GPT — bonus pay!"), tap ⓘ **Why this price?** to see
   the exact formula with this shop's numbers, then buy 3+ shards and **Haggle**: a 3-round card game against the shopkeeper's
   personality. *"My rival pays more"* only works if a rival you visited *really* pays more.
5. **Fight.** At the Louvre Forge open the **Arena** tab, pick 3 models (each has game stats in Math, Code, Writing, Vision, Speed,
   Languages), **Fight**. Each round reveals a task ("Find the bug…", "Write a haiku about the Seine…"): choose the model *and* the
   technique (Chain-of-thought is great at Math, High temperature is a creative gamble that can hallucinate), within a 10-token budget;
   the model you just used is *rate-limited* next round. Beat the Sentinel → you are the **Champion**, with a crown on the map.
6. **Raid & missions.** If a **Rogue Model** is loose (banner at the top; up to 2 a day), open the Forge's **Raid** tab and
   attack it with the city. Open **Quests** for your 3 daily missions, the chest and "Who holds the city".
7. **Forge.** Fly to a monument Forge, pick **Aura** (the top tier), **hold to compile**. You get a credit ticket with
   "≈ N chats" equivalences, a **Burn proof ↗** link to the NEAR explorer (the shards were burned on-chain *before* the credit),
   a shareable PNG card, and **Try it now** → the Playground.
8. **Proofs.** Profile › **Proofs** → your NEAR account, your settled operations, and **Verify on-chain**, which asks a public NEAR
   RPC node for your balances *from your browser*, without trusting our server.
9. **The city.** Open **[/pulse](https://tokengo-production-195c.up.railway.app/pulse)** (live ticker, Paris Shard Index, active city
   event, merchant health, on-chain status) and **[/lab](https://tokengo-production-195c.up.railway.app/lab)** → scenario
   *DeepSeek flood* → **Simulate 1 week**: 200 bots, the exact live rules, under a second, compared with a baseline week.

For AI triage (Claude Code / Codex): `npm install && npm run verify` runs typecheck, 292 unit tests, the production build and a
headless end-to-end smoke test of the whole loop. **No secret needed.**

---

## 💡 Why this game should exist

**The problem.** Location games reward walking with loot that is worth nothing outside the app. "Play-to-earn" games that pay
real value do the opposite: they print a token, the token dumps, the treasury goes insolvent, and the game dies with it.
Both fail for the same reason: the reward is not something people actually want to *use*.

**The insight.** In 2026 everyone uses LLMs, and inference is priced per token, in cents. It is the perfect game reward:
- **Useful the day you earn it.** Paste the key into any OpenAI-compatible tool and it works.
- **Naturally divisible.** A $0.03 compile is ≈ 20 chats; a top-tier compile is a real afternoon of AI.
- **Not a speculative asset.** Nobody farms it to dump it on a market; you spend it.

**The design.** A single, capped door from the game to real value (the Forge), paid as a *fraction of a reserve*, so the game
is **solvent by construction**: it can never promise more than it holds. Everything before that door (catching, trading,
haggling, arbitrage, rescuing shops) is a game you enjoy for its own sake, with its own in-game currency, Flux (ƒ).

**Why NEAR.** NEAR gives both halves under one roof: a fast, cheap L1 where an account per player and per merchant costs nothing
(named, keyless sub-accounts), and **NEAR AI Cloud**, whose organisations, per-key spend limits and NEP-413 login are exactly
the primitives a game needs to hand out capped, revocable compute. TokenGo uses both, and hides both.

---

## 🎮 The game loop, in depth

```mermaid
flowchart LR
  W["🚶 Walk / 🕊 Scout"] --> C["✨ Catch shards<br/>(lock-on + decode the next token)"]
  C --> MA["📈 Mastery per family"]
  MA --> AR["⚔️ Model Arena<br/>3v3 at monuments"]
  AR -->|"win"| CH["👑 Champion of the arena<br/>(Flux while you hold it)"]
  AR --> MA
  W --> RD["⚠️ Rogue Model raid<br/>(whole city, live HP)"]
  RD --> MA
  CH --> M
  W --> R["📡 Sync relays<br/>(Flux ƒ + shard)"]
  C --> M["🏪 Trade with AI shops<br/>(own stock = own price)"]
  R --> M
  M -->|"arbitrage: walk the spread"| M
  M --> H["🃏 Haggle"]
  H --> M
  M --> F["🔥 Forge recipe<br/>at a monument"]
  C --> F
  F -->|"burn on NEAR → credit"| K["🔑 Credits on your<br/>NEAR AI Cloud key"]
  K --> P["💬 Playground / any OpenAI-compatible app"]
  F --> X["⭐ XP, levels, unlocks"]
  X --> W
```

### 1. Move: walking for real, or Remote Scout
- **For real (GPS).** The game is designed to be walked. Your phone reports positions; the server decides what you can reach.
  Action radii: 40 m for shards, relays and shops, 60 m for Forges (+ up to 20 m of GPS-accuracy tolerance).
- **Remote Scout (couch mode).** A pigeon-drone you fly by tapping the map: cruise 30 km/h; anything faster than 40 km/h is a
  **Dash** that costs ×1.5 battery and is capped at 1.5 km per hop. Battery: −30 %/km, +8 %/min, grounded until 10 % when empty.
  The full demo loop around the Louvre fits in one battery (5–10 min). Every number is enforced **server-side**.
- **Why both.** Judges and remote players can play the whole game in five minutes; real players get the real thing outside.
  Scout accounts are "demo" accounts: they can never draw from the main reward pool.

### 2. Catch: a one-second skill test with depth
- Five families with real rarity: **DeepSeek** (common, 41 % of spawns), **Qwen** (common, 27 %), **Gemini** (uncommon, 19 %),
  **GPT** (rare, 9 %), **Claude** (epic, 4 %). Places have affinities (libraries favour Claude, stations GPT, parks Gemini…, ×3 weight).
- **Lock-on mini-game:** a ring shrinks toward a dashed circle. Rarer shards have a faster ring and a narrower PERFECT window
  (1.4 s / 7 % for commons → 0.8 s / 5 % for epics) and can **flee** after a miss (10–30 %). Three tries.
- **PERFECT** = +5 XP and a 25 % chance of a bonus shard. Good catches within 90 s of each other build a **combo** (up to ×5, +2 XP per level).
- Spawns are **deterministic**: `HMAC(secret, H3 cell, 10-min window)`. Everyone sees the same shards in the same place, and the
  server recomputes every spawn instead of trusting the client. λ = 0.8 + 0.25 × place richness, ≤ 3 per cell, visible within 250 m.
- **Shard Codex:** each catch rolls a purely cosmetic **variant**: Classic, Night (21:00–06:00 local *solar* time, so it works in any
  city), Landmark (≤ 300 m from a monument), Overclocked (PERFECT with combo ≥ 3) or Shiny (1 in 40). 5 × 5 = **25 entries**, +15 XP
  each, titles from *Shard Spotter* to *City Archivist*. Variants never change prices or recipes: collection, not power.

### 3. Decode: predict the next token
Rare (GPT) and epic (Claude) shards don't just get caught, they get **decoded**. After a good lock-on the screen flips into a
terminal: *"The pen is mightier than the ___"* → `crown` · `shield` · `sword`, 4 seconds (5 for epics). Questions come in each
family's style: sequences and arithmetic for DeepSeek, idioms and rhymes for Claude, general knowledge for GPT, emoji riddles for
Gemini, translations for Qwen (≥ 15 per family). Right token → caught, *"DECODED!"*. Wrong or late → the shard **hallucinates**
(glitch, chromatic split) and may flee. Commons get an optional **Decode bonus** (+XP, +Mastery, better Shiny odds on the next
catch — never an extra shard). The server picks the question from a seeded HMAC, shuffles choices under opaque ids, keeps the
answer, and measures the deadline itself: the answer never reaches the client before you choose.

### 4. Relays: the Flux faucet
Swipe the disc on a relay (fountains, statues, kiosks from OpenStreetMap): **3–7 Flux + a 50 % chance of a shard**, 5-minute
cooldown per relay, +20 XP the first time you visit one. Flux (ƒ) is the in-game coin.

### 5. Trade: every shop is a tiny market maker
- **153 shops** in Paris (real cafés, bakeries, bookshops…), each with its own **stock, treasury, specialty and personality**
  (8 archetypes: gambler, hoarder, scholar, hustler, grandma, purist, trend-chaser, night owl).
- **Price = f(its own stock):** `mid = P0 × clamp((target / stock)^1.1, 0.35, 3)`, buy/sell = `mid × (1 ± spread)`, spread 3–12 %.
  Each unit is priced at the stock *after* that unit, so **buying then selling back always loses** (tested on 500 random draws).
- **Result:** 15–40 % price gaps between shops 600 m apart. **Walking is arbitrage**, the most satisfying "aha" of the game.
- **"Why this price?"** Every quote opens a breakdown of the formula with this shop's live numbers, the active city event and
  your personal modifiers. No black box.
- **Shops are alive.** They import when low (Flux sink), sell surplus to "the city" when high (Flux source), pay rent when active,
  post **contracts** ("Need 5 GPT — bonus pay!", +5–15 %), and shout their state in speech bubbles on the map.
- **Bankruptcy and rescue.** Treasury < 150 ƒ → *closing* (2 h, −10 % clearance sale) → *closed*. Players can **rescue** a shop
  (≥ 50 ƒ each) until it reaches 600 ƒ; it reopens and the top contributor becomes its **Patron** (half spread for 7 days).
  Rescues are announced city-wide on the Pulse ticker ("Odile the Archivist reopened thanks to 1 patron").

### 6. Haggle: a card game that respects the economy
With 3+ shards in a deal you can **Haggle**: three rounds where you play cards (*Bulk*, *Regular*, *Rival*, *Bluff*, *Compliment*,
*Lowball*, *Walk away*) against the shopkeeper's trait (greedy, friendly or proud, read from their archetype) and patience. The
*Rival* card only works when it is **true**: you must have seen a rival's better price in the last 2 hours, and the server checks
it against that rival's real current price; a *Bluff* can be caught. Bounds are hard: discount ≤ 5 % + 0.3 pt per reputation point,
**never more than 8 %, never closer than 1 % to the shop's mid-price** (so haggling can never create a buy-low/sell-high loop),
2 sessions per shop and 6 per player per day, quotes expire in 90 s. Reputation runs from −5 to +10; lose the shopkeeper's patience
and they sulk for 20 minutes (−3 % on your quotes).

### 7. Model Arena: your shards fight
Every Forge is also an **Arena**. A battle is 3 models vs 3 models over up to 5 **challenges** drawn from the six categories people
actually use to compare LLMs: 🧮 Math, 💻 Code, ✍️ Writing, 👁 Vision, ⚡ Speed, 🌐 Languages, each with a concrete prompt
("Is this a croissant or a cat curled up? 🥐🐈", "Find the bug in 12 lines of Python"). Each family has a **style** (game stats,
explicitly *not* benchmarks):

| Model | Math | Code | Writing | Vision | Speed | Lang | Style |
|---|---|---|---|---|---|---|---|
| Claude | 7 | 9 | 10 | 7 | 5 | 8 | the writer-coder |
| GPT | 8 | 8 | 8 | 9 | 6 | 8 | the all-rounder |
| Gemini | 7 | 7 | 7 | 10 | 7 | 9 | the eye, long context |
| DeepSeek | 9 | 8 | 6 | 4 | 8 | 6 | the cheap mathlete |
| Qwen | 7 | 7 | 6 | 6 | 9 | 10 | the speedy polyglot |

Each round you pick **a model and a prompting technique**, the opponent picks simultaneously (server policy, it never sees your pick):

| Technique | Tokens | Effect |
|---|---|---|
| Zero-shot | 0 | ×1.0 |
| Chain-of-thought | 3 | ×1.5 on Math/Code, ×1.15 elsewhere, halves hallucination risk |
| Few-shot | 2 | ×1.3 on Writing/Languages, halves variance |
| Tool use | 2 | +3 power on Math/Vision/Code |
| High temperature | 1 | ×1.4 on Writing, double variance, double hallucination risk |

`power = stat × mastery × technique × (1 ± 12 %)`; an 8 % base **hallucination** chance crushes an answer to ×0.3. You have
**10 tokens** per battle, and the model you just played is **rate-limited** next round, so you must rotate your team: commons played
well beat rares played badly. Each commentary line explains the round ("Claude read it through the rain. DeepSeek needed glasses.").

**Sentinels and Champions.** A Forge is guarded by a Sentinel (an AI team of the day). Beat it — or beat the current Champion —
and your team becomes the arena's **Champion**: frozen as a ghost that defends while you're away, a crown in your district's colour
on the map, +4 ƒ every 10 minutes held (240 ƒ/day max), announced on the city ticker. Champions inactive for 48 h fall back to the
Sentinel. Entry 10 ƒ, 12 battles/day, unlocks at level 2. Rewards: win 60 XP + 20 ƒ (100 XP + 30 ƒ against a Champion), defeat
15 XP. The difficulty was tuned by simulation (2 000 battles): a brand-new team wins ≈ 40–50 % against the Sentinel by playing the
obvious move, more by playing smart.

**Mastery.** Every family levels from 1 to 10 (catches +5, decodes +5, arena rounds +10/+10 if won, raids +20): +4 % power per
level. Your collection finally has a purpose.

### 8. Rogue Model raids: the whole city vs one AI
Up to twice a day (and on demand for demos), a model **breaks loose** at a Forge: *GL1TCH-9*, *Overfit Prime*, *The Hallucinator*,
*Loop.exe*, *Token Hydra*. One shared HP bar (`800 + 120 × active players`, capped 6 000) drops live for everyone over SSE — on the
map marker, the banner, the Forge's **Raid** tab and `/pulse`. Its **weakness** (×1.5) and **resistance** (×0.6) rotate every
10 minutes, so the city has to adapt its strike teams. Each player gets 3 free **assaults** of 3 rounds on the Arena engine
(6 tokens), damage flies off the boss, and a live leaderboard ranks the city (runner bots chip in, real players make the
difference). If the city wins within 45 minutes: 80 XP + 30 ƒ + Mastery for every participant, +40 ƒ for the top 3, and the Codex
title **Rogue Slayer**. Resolution happens exactly once, in a transaction (tested with 6 simultaneous killing blows).

### 9. Forge: the only door to real value
Ten monument Forges (Louvre Pyramid, Notre-Dame, Eiffel Tower, Arc de Triomphe, Sacré-Cœur, Panthéon, Centre Pompidou, Bastille,
BnF, Station F) publish **daily recipes**. Three tiers plus a tutorial compile:

| Tier | Unlocks at | Recipe (by rarity) | Fee | Weight |
|---|---|---|---|---|
| **First Compile** | level 1 | 2 DeepSeek + 1 Qwen | — | fixed $0.03 |
| **Spark** | level 3 | 4 common + 2 uncommon | 60 ƒ | ×1 |
| **Prism** | level 5 | 3 common + 3 uncommon + 2 rare | 160 ƒ | ×3 |
| **Aura** | level 7 | 2 common + 3 uncommon + 2 rare + 2 epic | 300 ƒ | ×8 |

`payout = min(pool × 0.4 % × weight, player cap $0.25 / 24 h, city cap 5.5 % of the pool / day)`, scaled by reserve health
(payouts shrink smoothly as the reserve drains, never to zero, never above what is held). Hold to compile → **the shards are burned
on NEAR first**, then the credit is granted → a ticket with "≈ 20 DeepSeek chats / ≈ N Claude Sonnet tokens" equivalences,
**Burn proof ↗**, a share card, and **Try it now** → an in-game Playground that calls the models with *your* key, plus copy-paste
`curl` / OpenAI SDK snippets.

### 10. A city that lives without you
- **24 runner bots** walk real streets and trade 24/7 with the same rules and the same API as players, so prices move overnight.
- **Living map:** up to 12 walkers around you: bots, and **real players shown anonymously** (snapped to their H3 cell + 60 m jitter,
  identifier rotating every 10 min, only visible near the viewer).
- **City events** (one at a time, shared by everyone in a zone, 15–20 min, strictly bounded):
  *Flash crash* (DeepSeek, Qwen or Gemini at −40 %), *Hype* (Gemini or GPT at +25 %), *Gold rush* (bonus waves of GPT or Claude spawns),
  *Merchant strike* (shops in the zone stop selling, still buy). Hard bounds: price multiplier 0.6–1.3, 45 min max, the reserve is never
  touched. Events start on their own during the day, appear as a banner + map overlay, and show up in every "Why this price?".
- **Merchant brains:** every 3 hours each shop "reflects" and may nudge its spread and stock targets (±30 % max per reflection,
  within hard bounds) and update its mood line. With NEAR AI Cloud this runs on a cheap TEE-hosted model with JSON-schema output,
  ≤ 150 calls/day, clamped by the server; in demo season (and on any LLM failure) the same interface is served by a deterministic
  policy. **The LLM never moves value**: it can only choose parameters inside the public rules file.

### 11. Reasons to come back tomorrow
- **Daily missions:** 3 per day drawn for you (always one Arena/Decode mission): *Decode 3 tokens*, *Win an arena battle*,
  *Catch 3 different families*, *Close a haggle deal*, *Sync 4 relays*, *Hit a ×3 combo*, *Trade at 2 shops*, *Deal 200 raid
  damage*… +40 XP + 15 ƒ each, and a **daily chest** (+60 ƒ + 1 Gemini) when all three are claimed. A red dot on Quests tells you.
- **Who holds the city:** every arena's holder, how long they've held it, and the **Top Champions** of the week, coloured by
  district — your arrondissement against the others.
- **Daily Route:** 3–5 real stops within 500 m of your neighbourhood (the same route for everyone on the block that day, seeded by
  `(day, H3 r8 cell)`). Reward: 200 XP + 60 ƒ + streak bonus (+10 ƒ/day, max +30) + a guaranteed Gemini.
- **Daily Forge recipes**, shop contracts that expire, the Codex, Patron perks, levels 1–20 (`XP to next = 100 × L^1.5`) with
  unlocks at 2 (trade), 3 (Spark), 4 (contracts), 5 (Prism), 6 (rescue), 7 (Aura).
- **Share cards** (1200 × 675 PNG) for catches, Codex pages and compiles, made for X.
- **District leaderboards.**

---

## 📊 The economy: a living market you can read

All constants live in **one readable file**: [`packages/shared/src/economy/rules.ts`](packages/shared/src/economy/rules.ts).
Every formula next to it is a **pure, tested function** (`pricing.ts`, `market.ts`, `forge.ts`, `reserve.ts`, `spawns.ts`, `agent.ts`,
`haggle.ts`), imported by the **server**, the **simulator** and the **UI**. What the Lab simulates and what "Why this price?"
explains is literally the code that runs the game.

| Flux sources (in) | Flux sinks (out) |
|---|---|
| Relays (3–7 ƒ) | Forge fees (60 / 160 / 300 ƒ) |
| Selling shards to shops | Buying shards from shops (spread) |
| Shops exporting surplus to "the city" (P0 × 0.75) | Shops importing when low (P0 × 1.3) |
| Daily Route reward | Shop rent (4 ƒ/h, only when active) |
| Shop contracts (+5–15 %) | Rescues (≥ 50 ƒ) |
| Arena wins (20–30 ƒ), Champion income (≤ 240 ƒ/day) | Arena entry fee (10 ƒ) |
| Raid rewards (30 ƒ, +40 ƒ top 3), daily missions (≤ 105 ƒ/day) | |

- **Reference price (Paris Shard Index):** `P0 ← 0.95 × P0 + 0.05 × P0₀ × median scarcity`, bounded to 0.6–1.4 × P0₀: anchored,
  no runaway inflation, visible live on `/pulse`.
- **The reserve** (real money, counted in integer nano-USD) is partitioned into pools: *main* (players who proved a walk),
  *welcome* (one First Compile per guest, global cap 4/hour), *judge* (judges' passes, $0.20 per account), *npc* (merchant brains)
  and *safety*.
- **Health targets**, checked by the simulator and by a unit test: shop prices stay within 0.6–1.8 × P0, ≥ 15 % gap between nearby
  shops (arbitrage exists), ≥ 10 % of shops struggle in a week (rescues happen) but ≤ 30 % are closed, the main pool drains ≤ 35 %/week.
- **Economy Lab (`/lab`):** the simulator runs in a Web Worker in your browser: 200 bots (walkers, arbitrageurs, forgers, patrons,
  flooders) × 7 days of Paris in under a second. Scenarios (*DeepSeek flood*, *reserve refill*, *everyone does Aura*) are compared
  with a baseline week, with a story-mode explanation of what happened.
  CLI version: `npm run sim -- --days 7 --players 200 --scenario flood-deepseek --seed 42`.

Full design rationale: [`Docs/03-economy.md`](Docs/03-economy.md).

---

## ⛓ How NEAR is used (and hidden)

The track asks for a game where *players never notice the chain*. The words *blockchain, wallet, gas, transaction* appear nowhere
in the game loop, only behind **Profile › Proofs** and **Pulse › On-chain**, for the curious. Underneath, every item lives on NEAR.

```mermaid
sequenceDiagram
  autonumber
  participant P as Player (browser)
  participant S as Game server
  participant DB as SQLite (WAL)
  participant ST as Settler (every 8 s)
  participant C as tokengo.testnet (NEP-245)
  participant AI as NEAR AI Cloud
  P->>S: intent (catch / trade / compile)
  S->>DB: one transaction: game state + outbox op
  S-->>P: instant result (no waiting on chain)
  ST->>DB: take pending ops
  ST->>C: op_settle(ops, settlement_id), batched and idempotent
  C-->>ST: NEP-245 mint / burn / transfer events
  Note over P,C: Compile is the exception: the burn is settled FIRST
  P->>S: hold to compile
  S->>C: burn shards (waits for the result)
  S->>AI: raise spendLimit of the player's API key
  S-->>P: credit ticket + Burn proof ↗ (explorer link)
```

### The contract: [`contracts/tokengo-mt`](contracts/tokengo-mt) → **`tokengo.testnet`**
A homemade **NEP-245 multi-token** contract in Rust (near-sdk), one contract for every item:
`flux`, `shard:deepseek`, `shard:qwen`, `shard:gemini`, `shard:gpt`, `shard:claude`.

| Method | Who | What |
|---|---|---|
| `op_settle(ops, settlement_id)` | operator | Applies a whole batch of mint / burn / transfer **atomically**; **idempotent** (a `settlement_id` applies once; `is_settled` to check) |
| `op_mint_batch`, `op_burn_batch`, `op_transfer_batch` | operator | Batch primitives with memos |
| `mt_transfer`, `mt_batch_transfer` | any holder | Standard NEP-245 transfers (1 yocto); players' accounts can move their own tokens |
| `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`, `mt_token`, `mt_tokens` | anyone | Standard views, used by the in-game **Verify on-chain** button |
| `set_operator`, `set_paused`, `get_config` | owner | Operator rotation and an emergency pause |

Events are standard NEP-245 `EVENT_JSON` logs, **aggregated per type** per batch (one `mt_mint`, one `mt_burn`, one `mt_transfer`)
to keep receipts small. `mt_transfer_call` is deliberately unsupported (no cross-contract attack surface). Contract unit tests cover
settlement, idempotency, events, transfers and views.

### Accounts: one per player and one per merchant, invisible
Logical accounts map to named sub-accounts (`p-<id>.tokengo.testnet` for players, `<merchant>.tokengo.testnet` for shops), created
lazily and **keyless** (zero-balance accounts), so onboarding is instant and free. The model is **custodial by the game operator**,
and the game says so; "export my account" is on the roadmap.

### Settlement: fast game, honest ledger
- Every value move is written to an **outbox in the same SQLite transaction** as the game state: the game never blocks on the chain,
  and the chain never misses a move.
- The **settler** batches pending ops every 8 s into `op_settle` with a deterministic `settlement_id`; retries check `is_settled`
  first, and "already applied" counts as success → **exactly-once on-chain**, even across crashes.
- **Burn-before-credit:** a compile debits the shards and queues their burn *before* anything is granted, then forces the settler
  to push every pending op up to that burn and waits (up to 20 s) for its transaction, shown on the ticket as **Burn proof ↗**.
  If the chain is slower than that, the ticket says "Burn settling on NEAR…" and the proof appears in Profile › Proofs seconds later.
- **Reconcile:** `npm run reconcile` compares every on-chain balance with the database.

### Proofs the player can check without trusting us
Profile › **Proofs**: your NEAR account on the explorer, every settled operation with its transaction, and **Verify on-chain**,
which calls `mt_batch_balance_of` on a public RPC node **from the browser**. City Pulse › On-chain shows the settler's live status
(pending ops, last batch, contract).

### NEAR AI Cloud
| Piece | How |
|---|---|
| **Organisation login** | The game holds a NEAR AI Cloud organisation; the server obtains its session with a **NEP-413** signed message ([`nearai/nep413.ts`](apps/server/src/nearai/nep413.ts)) |
| **One API key per player** | Each player gets a personal key; Forge payouts **raise its `spendLimit`**. Keys are encrypted at rest (AES-256-GCM), revocable, revealable by the player |
| **Solvency invariant** | Checked before every grant: `Σ(limit − usage) + overshoot × keys + NPC budget + safety ≤ organisation balance`. The reserve **never promises more than it holds** |
| **Merchant brains** | Cheap TEE-hosted model, JSON-schema output, clamped to the rules, ≤ 150 calls/day (30 haggle lines/day), deterministic fallback |
| **Private inference** | The Playground lists TEE-verifiable models with a badge |
| **Playground** | An in-game chat that calls NEAR AI Cloud with *your* key, plus `curl` / OpenAI SDK snippets to use it anywhere |

---

## 🧪 Demo season → real credits

**What runs today on the public server:** the full game and the NEAR testnet settlement (mint / transfer / burn, burn proofs,
Verify on-chain), merchants, events, runners, Codex, routes, haggling, the Forge, with **credits marked "demo"**. The game says so
plainly on the splash screen, the credit ticket, the credits screen and the About page. We chose this so that **anyone can play the
whole loop for free during judging**, without us rationing a real budget.

**What is already built for real credits** (covered by unit tests with the exact NEAR AI Cloud request shapes): NEP-413 session,
per-player key creation, `spendLimit` raises, usage polling, revocation of keys that overshoot, the reserve partition and the
solvency invariant, a pending-credit queue when the organisation balance is stale, and a smoke script
(`node apps/server/scripts/nearai-spike.ts`, < $0.001) to validate a funded organisation.

**Switching on** means setting `NEARAI_AUTH_ACCOUNT`, `NEARAI_AUTH_KEY` and `FEATURE_REAL_CREDITS=1` on the server once the city
reserve is funded. From then on every compile lands as real inference on the player's own key, and the "demo" badges disappear by
themselves.

---

## 🌍 Play anywhere on Earth

Paris is hand-built: `npm run build-world` turns OpenStreetMap extracts into 1 223 game nodes on an H3 grid. **Everywhere else**:
1. When a player's **server-verified** position enters an unknown H3 resolution-7 cell (~5 km²), the server queues a region build.
2. It queries **Overpass** (OpenStreetMap) for real POIs: fountains and statues → relays, cafés and shops → merchants, landmarks →
   Forges (≥ 1 km apart), with caps per region.
3. If Overpass hasn't answered in 8 s, a **deterministic procedural region** is served immediately; the real OSM region replaces it
   when it arrives (within 15 min, if nobody has played there yet).
4. Abuse bounds: generation only around a fresh server-side position (≤ 1 km, ≤ 5 min old), 300 regions/day globally,
   12/day per network (/64 for IPv6), mirror fallbacks, kill switch `WORLD_ANYWHERE=0`.

Night variants use local *solar* time, so the Codex works in Tokyo as well as in Paris.

---

## 🛡 Security, anti-cheat and solvency

**Server-authoritative by design:** the client only sends *intents*. Positions, spawns, prices, inventory, XP and credits are all
decided server-side.

- **Spawns:** recomputed from `HMAC(SPAWN_SECRET, cell, window)`; catches keyed `(user, spawn)` → no double catch, no forged shard.
  Catch attempts expire in 30 s and resolve no faster than 300 ms; a PERFECT rate above 40 % over 30 catches is downgraded to "good".
- **Movement:** rolling 60 s speed > 25 km/h → *in transit* (actions paused); impossible jumps (> 200 km/h over > 1 km) → soft-lock,
  flagged after 3 a day; action distance re-checked server-side; **proof of walk** (1.5 km of plausible segments ≤ 8 km/h at ≤ 30 m
  accuracy) before a signed-in player can draw from the main pool.
- **Trading:** quotes are single-use, short-lived and bound to the merchant's version (`PRICE_MOVED` if the market moved);
  "buy then sell back" is provably a loss; haggling is bounded by a cost floor.
- **Money:** compiles are serialized per player; the grant is reserved inside the burn transaction (no double spend under
  concurrency); per-player, per-day and per-city caps; guests get exactly one First Compile (global cap 4/hour); judges' passes are
  one per network per day and cannot sell; kill switch `POST /api/admin/forge/pause`.
- **Battles & raids:** the client only sends `{family, technique}`; the server draws challenges from a seed, checks team, budget and
  rate limit, rolls power and hallucination, and pays bounded Flux/XP only. Decode answers stay server-side with a server clock.
  Test-only knobs exist only when `NODE_ENV=test` *and* with the admin token.
- **LLM safety:** no free-text player input ever reaches a merchant LLM; outputs are JSON-schema validated and clamped to
  `AGENT_BOUNDS`; daily budgets; deterministic fallback.
- **Web:** Origin check on every write, `SameSite=Lax` HttpOnly signed session cookie, strict CSP, per-route rate limits, daily quotas,
  secrets encrypted at rest, `npm run check:secrets` scans the repo and its history.
- **Privacy:** guests need no email; we keep the last position only (no route history); real players appear to others only as
  cell-level anonymous walkers; **Delete my account** (About page) revokes the key and anonymizes everything.
- **Honest limits:** browser GPS can be spoofed, so we **bound what cheating can earn** (caps, proof of walk, reserve partition)
  instead of pretending to stop it. Player NEAR accounts are custodial.

---

## 🎨 Art direction, UX and game feel

- **"Pixel Pop Paris":** pixel-art sprites (Sweetie 16 palette, ink outline) on a flat, colourful, daytime cartoon map. Every
  in-game sprite (shards and their variants, 8 merchant archetypes, the avatar, the pigeon, relays, Forges, walkers, crowns and
  shields, the glitched Rogue Model bosses, the daily chest) is a
  **hand-written text grid** in [`apps/web/src/sprites/`](apps/web/src/sprites), rendered at runtime with no sprite sheet.
  Splash art, logo and cover were made with an image model; no existing character is reproduced.
- **Juice:** shrinking-ring lock-on with PERFECT flashes, combo flame, variant reveal, rolling counters, hold-to-compile with a
  charge-up, a printed credit ticket, speech bubbles, event banners, chiptune sound effects synthesized with WebAudio, haptics on Android.
- **Thumb-first:** every action sits at the bottom of the screen; one primary button always points at your current objective;
  contextual targeting picks the shard, shop or Forge you are actually next to.
- **Onboarding:** Margot, a grandma shopkeeper, guides the first five steps in one-line bubbles (skippable); the first loop
  (catch → relay → trade → First Compile) takes about three minutes.
- **Desktop:** the game opens inside a phone frame with an explainer panel and a **QR code** to continue on your phone.
- **Accessibility:** large tap targets, readable fonts (Pixelify Sans for titles, Nunito for text), `prefers-reduced-motion`
  respected for banners and the Lab animation.

---

## 🏗 Architecture

```
 Browser: React 19 + MapLibre GL (OpenFreeMap tiles), Zustand, Motion, sprites from text grids, Web Worker simulator
   │  JSON over HTTPS + Server-Sent Events (same origin, no CORS)
 Fastify 5 server: Node 24 + TypeScript, ONE process
   ├─ game logic (actions, market, haggle, forge, codex, routes, events, regions, runners, walkers)
   ├─ shared pure economy rules (packages/shared): same code as the simulator and the UI
   ├─ SQLite (better-sqlite3, WAL, hand-written SQL, numbered migrations)
   ├─ outbox ──► settler ──► NEP-245 contract on NEAR testnet (near-kit)
   └─ NEAR AI Cloud: NEP-413 session → per-player API keys (spendLimit) · merchant brains · playground relay
```

| Folder | What |
|---|---|
| [`apps/web`](apps/web) | React app: map, HUD, catch, shops, haggle, Forge, credits & Playground, Codex, Proofs, `/pulse`, `/lab`, `/about` |
| [`apps/server`](apps/server) | Fastify API, game logic, chain settler & reconcile, NEAR AI Cloud client, world generation, runner bots |
| [`packages/shared`](packages/shared) | Types, **economy rules** and pure formulas, the simulator |
| [`contracts/tokengo-mt`](contracts/tokengo-mt) | NEP-245 contract (Rust, near-sdk) |
| [`data/world`](data/world) | Paris built from OpenStreetMap |
| [`e2e`](e2e) | Playwright flows on a mobile viewport with simulated geolocation |
| [`Docs`](Docs/00-INDEX.md) | The full design spec (vision, game design, economy, geo, architecture, blockchain, NEAR AI, security, UX, testing) and the decision log |

**Deliberately boring infrastructure:** one container, one process, one SQLite file on a volume. No ORM, no micro-services, no
heavy state framework. It deploys anywhere Docker runs (`Dockerfile` + `railway.json` included) and serves the built front itself.

---

## ✅ Quality: how we know it works

| Check | Command | What it covers |
|---|---|---|
| **292 unit tests** | `npm test` | Arena engine (determinism, budgets, rate limit, policy never peeks), Decode bank and anti-leak, raid HP/damage/once-only resolution, missions & chest bounds, economy invariants, pricing exploits (buy-then-sell), haggling bounds, Forge caps, reserve solvency, spawn determinism, anti-cheat, regions & Overpass fallback, API routes, settler idempotency, NEAR AI request shapes, NEP-413 |
| **36 end-to-end flows** | `npm run e2e` | Real browser, mobile viewport, simulated GPS: onboarding, catch, **decode**, **arena battle + rate limit**, **raid assault + victory**, **daily missions + chest**, city control, relay, trade, haggle, Forge, credits, Codex, Daily Route, events, Remote Scout battery, play-anywhere, Pulse, Lab, account deletion… |
| **Contract tests** | `cargo test` in `contracts/tokengo-mt` | Settlement, idempotency, events, transfers, views |
| **Economy health** | `npm run sim` | 7-day simulations with health targets |
| **One-shot verification** | `npm run verify` | Typecheck + unit tests + production build + headless e2e smoke, **no secrets needed** |
| **Ledger** | `npm run reconcile` | On-chain balances vs database |
| **Secrets** | `npm run check:secrets` | No secret in the repo or its history |

The screenshots in [`docs-assets/shots`](docs-assets/shots) are produced by the e2e suite itself (`npm run shots`), and the demo
video is recorded by Playwright and edited with ffmpeg (`npm run video`), so they always show the real game.

---

## 🛠 Run it yourself

Requirements: Node ≥ 24, npm 11. No secret needed.
```bash
npm install
npm run build          # builds the web app (served by the server)
npm run dev            # web http://localhost:5173 + API :8787 (demo credits; chain off without .env)
```
Open **http://localhost:5173/?demo=1** → **Remote Scout**. Trigger a city event:
`curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Origin: http://localhost:5173" localhost:8787/api/admin/event`.

- **Turn on the chain:** copy `.env.example` to `.env` and set `NEAR_CONTRACT_ID`, `NEAR_OPERATOR_ID`, `NEAR_OPERATOR_KEY` (testnet).
- **Turn on real credits:** `NEARAI_AUTH_ACCOUNT` + `NEARAI_AUTH_KEY` + `FEATURE_REAL_CREDITS=1`, then `node apps/server/scripts/nearai-spike.ts`.
- **Production** also needs `MASTER_KEY` (32 bytes base64), `SESSION_SECRET`, `SPAWN_SECRET`, `TRUST_PROXY`, and optionally
  `DEMO_TOKEN`, `ADMIN_TOKEN`, `GOOGLE_CLIENT_ID/SECRET`.

**Deploy:** `Dockerfile` + `railway.json`: one service, SQLite on a volume mounted at `/data`, HTTPS required for browser GPS.
On Railway the public domain is picked up automatically (`RAILWAY_PUBLIC_DOMAIN`). Serverless function hosts don't fit: the game
needs a persistent SQLite file, background jobs and SSE.

Other commands: `npm run sim`, `npm run shots`, `npm run video`, `npm run build-world`, `npm run reconcile`, `npm run check:secrets`.

---

## 🗺 Roadmap
1. **Real credits on:** fund the city reserve and flip `FEATURE_REAL_CREDITS`; every compile becomes real inference on the player's key.
2. **NEAR mainnet:** same contract, same settler; then **"export my account"**, handing players the keys to their sub-account
   (optional self-custody for those who want it).
3. **Seasons & cities:** hand-tuned showcase cities beyond Paris, seasonal Codex variants, city-vs-city events.
4. **Player-owned shops:** open your own shop on a real café, set your spreads within the rules, earn from the flow.
5. **Guilds:** district crews that share arenas, raid together and co-op Forge recipes needing several players at a monument.
6. **Native wrappers:** background location and push notifications ("a shop near you is closing!").

---

## 📜 Hackathon disclosure
- **Built during the hackathon, from scratch:** the first commit (2026-11-06) contains only the spec; all code was written during the
  event. No pre-hackathon code, no existing product on another chain. The submitted state is tagged `hackathon-submission`.
- **AI-generated code:** most of the code, tests and docs were written with AI coding agents (Claude Code, Anthropic) under the
  direction of the solo developer; the full design spec and every decision are in [`Docs/`](Docs/00-INDEX.md). Splash, logo, cover and
  icons were generated with an image model (Codex imagegen); the in-game pixel sprites are hand-written text grids.
- **Demo season:** AI credits on the public server are simulated (see above); the NEAR testnet settlement is real.
- **Data:** map data © OpenStreetMap contributors (ODbL), tiles © OpenFreeMap / OpenMapTiles.
- **Libraries:** React, React DOM, Vite, MapLibre GL, Zustand, Motion, clsx, lucide-react, qrcode-generator, @fontsource (Pixelify Sans,
  Nunito), Fastify (+ @fastify/cookie, rate-limit, static), better-sqlite3, zod, h3-js, near-kit, @noble/hashes, @noble/curves, arctic;
  contract: near-sdk (Rust), cargo-near; tooling: TypeScript, Vitest, Playwright, sharp, ffmpeg. No game template was used.

## Other project by the same author

[Anyone Can Rug](https://github.com/ebenbaruk/near-memecoin) (track: memecoins), independent of TokenGo: no shared code, contract or token.

## License
MIT
