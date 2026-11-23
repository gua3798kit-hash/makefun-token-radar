# Pre-token radar

An entry for make.fun's **token-radar-01** bounty: a static dashboard that finds the protocols in a
sealed DefiLlama snapshot that record no token, ranks them by what a token would be worth on today's
record, and gives each one a costed farm plan.

## Run

Node 22.18 or later, standard library only, nothing to install.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
node tools/check.ts out path/to/snapshot.json   # self-check of the gate's seven rows
```

In the grader's container it reads `/input/snapshot.json` and writes `/output`:

| File | What it is |
| --- | --- |
| `board.json` | 198 ranked rows: slug, name, rank, implied_value_usd, farm_steps, plus the model's factors |
| `data.js` | the raw snapshot, which the page reads |
| `dashboard/` | the page: `index.html`, `app.css`, `app.js`, `model.js` |
| `screenshots/` | board, protocol detail, filtered board, value model |
| `dossier.json` | written by `vendor/makefun-board.ts` (`buildDossier`) |

Both runs write identical bytes: nothing reads the clock or a random source.

## The model

`dashboard/model.js` is the single source of the model. `main.ts` evaluates it under `node:vm` to write
`board.json`; the page loads the same file and recomputes every figure it shows from the raw snapshot.

```
implied = TVL
        x peerMultiple(category)           market's mcap/TVL for tokens already trading in that category
        x sqrt(1 + clamp(change_7d, -50, 100) / 100)
        x tokenless(days since listed_at)  0.70 at launch -> 1.15 at two years, fading after three
        x (1 + 0.04 x (min(chains, 6) - 1))
        x parent                           0.5 when the token would likely accrue to a parent
```

* **Peer multiple** is calibrated on the snapshot itself: the 128 protocols whose token trades with a
  market cap. Ratios are clipped to 0.01x..5x, the category log-median is shrunk toward the global
  median (weight 4), so a category with one peer cannot swing the board.
* **Board membership** follows the watchlist's own published rules (no token recorded, not a bridge,
  CEX, liquid-staking or restaked-BTC category, no version suffix, no wrapped/staked word, no exchange
  prefix): 198 rows, all 40 watchlist slugs included. Protocols with a token (416) and the 144
  token-less wrappers are shown apart, never ranked.
* **Parent link**: a protocol above the $50M floor that passes every visible watchlist test yet is off
  the list must carry a DefiLlama `parentProtocol`; below the floor, a name shared with a token that
  trades is the signal.
* No protocol is named anywhere in the model code.

## Farm plans

Every row gets 7 steps: verify, fund, two category-specific moves (lending, vaults, trading, RWA,
staking, chain/payments), weekly upkeep, exit rules, budget. Each step carries its cost (from an
assumed per-chain transaction cost table) and time. The ticket is the smallest deposit whose modelled
drop (6% of implied value spread pro rata over TVL) covers the plan's fixed costs five times, from
$250 to $5,000; the plan states its break-even deposit and a verdict (worth a ticket / marginal /
costs dominate).

Implied value is a model output, not a forecast and not financial advice. "Records no token" means
DefiLlama's index carries none; that record can be incomplete.
