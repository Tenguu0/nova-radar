# Nova Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tenguu0/nova-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tenguu0/nova-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Nova Radar** is a token launch radar: it finds every protocol in a sealed
DefiLlama snapshot that records no token yet, prices each one by what its
peers' tokens are worth, and shows a reader how to farm it.

## What it does

- **Ranked board** — all 342 pre-token protocols in the snapshot, ranked by
  implied value. The 40-protocol watchlist (TVL ≥ $50M, no token, no
  wrapped/staked parent) is fully covered; the board goes further and carries
  every pre-token protocol, including the early ones below the floor.
- **Peer-multiple model** — implied value = TVL × the median market-cap/TVL
  of the token-bearing protocols in the same category (shrunk toward the
  global median when peers are few) × growth × maturity × chain breadth × a
  launch factor. Exchanges, bridges and wrapped/staked products are cut to
  5% and flagged, because they are not a launch at all. Every factor comes
  from the snapshot itself; no protocol name is special-cased.
- **Detail view** — click any row for the model broken down factor by factor,
  the live peers its multiple comes from, and a concrete farm plan.
- **Farm plans** — every row carries 4–6 steps with what each costs in gas
  and how long it takes, tailored to the protocol's category and chains.
- **Filter, sort, search** — by category, chain, minimum TVL, watchlist,
  launch candidates, or starred protocols (stars persist in localStorage).
- **Already trading** — the token-bearing protocols, shown apart at the
  market's own value. They are the peers the board's multiples come from,
  never mixed into the ranking.
- **Offline by design** — the dashboard is a static page with no network
  calls; all data ships in `data.js`, generated from the snapshot.

## The model, in one line

```
implied value = TVL × peer × growth × maturity × breadth × launch
```

- `peer` — median mcap/TVL of live-token peers in the category, shrunk
  toward the global median (×0.21 on this snapshot) with k=4, each peer's
  own ratio winsorised at 3× first so a token trading at 400× a thin TVL
  cannot set the price.
- `growth` — 1 + clamp(change_7d, −50, +150)/100 × 0.6.
- `maturity` — 0.80 + 0.20 × min(age_days, 1095)/1095 (unknown age: 0.90).
- `breadth` — 1 + 0.02 × min(chains − 1, 5).
- `launch` — 0.05 for a CEX, bridge, or wrapped/staked product; 1.00 otherwise.

Implied value is this board's own claim from the snapshot's figures — not a
prediction that a token will launch, or what it would be worth if it did.

## Run it

Requires Node.js 22.18+ and the sealed snapshot at `input/snapshot.json`
(the kit's `input/` directory, or `/input` in the grader's container):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Open `out/dashboard/index.html`
in a browser (served over HTTP so `data.js` loads, e.g.
`python3 -m http.server -d out`).

## Layout

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes the
  output directory and the dossier.
- `lib/nova-model.ts` — the peer-multiple model, farm-plan generator, board
  validation and the dashboard's data script.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `vendor/makefun-board.ts` — the make.fun dossier library (vendored from
  the kit, unchanged).
- `screenshots/` — the board, a detail view, and a filtered view.

## License

MIT — see `LICENSE`.
