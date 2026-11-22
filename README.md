# Launch-Odds Radar v3

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A fitted token launch radar: it reads a sealed DefiLlama snapshot, ranks
198 pre-token protocols by the expected value of the token each might one
day issue, and hands in a dashboard with the board, a detail view and farm
plan for every protocol, and the filters to find the early ones. All 758
protocols in the snapshot are accounted for on the dashboard: 198 ranked,
144 excluded pre-token (with reasons), 272 token-recorded with no market
cap, and 144 traded.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

Node 22, standard library only, no network. The program writes
`out/board.json` (the ranked board), `out/data.js` (the dashboard's data),
`out/dashboard/` (the static page), `out/screenshots/` and
`out/dossier.json` (the judge's dossier, built with the vendored
`vendor/makefun-board.ts`).

## How the value is priced

Terminal value = TVL x peer multiple x growth x maturity x breadth.
The peer multiple is the category median log(mcap/TVL) of the traded
protocols, shrunk toward the global median with weight n/(n+8). The
growth, maturity and breadth terms are fitted by grid search on the
128 traded protocols, minimising the median absolute log error.
Launch odds are the category's traded share, shrunk toward the global
traded share with weight n/(n+20). Expected value = terminal value x
launch odds; the board ranks by expected value. One function scores
every protocol and no name is special-cased, and the dashboard shows
the working for every row.

## How the fit is tested

Two hold-out tests, both computed from the snapshot at run time and
shown on the dashboard's KPI strip, with the naive baseline (the global
median multiple alone) on the same splits:

- H1, 5-fold cross-validation: the peer map and the fitted terms are
  refit inside each fold, and each fold is predicted by a fit that
  never saw it.
- H2, leave-one-out: each traded protocol is predicted by a peer map
  refit without it, with the fitted terms held from the full fit.

Typical miss is exp(median |log predicted − log actual|). Run the
program to see the numbers for this snapshot; they are printed on
stdout and rendered on the dashboard.

## Farm verdicts

Farm: expected value at least $25M and launch odds at least 7%.
Thin: expected value at least $5M. Skip: everything else. Each row's
farm plan is six concrete steps with a cost and a time, sized by a
deposit that follows the protocol's TVL ($250 / $150 / $75).

---

Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards
