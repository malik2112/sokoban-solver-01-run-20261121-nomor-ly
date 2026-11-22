# sokoban-solver-01-run-20261121-nomor-ly

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/malik2112/sokoban-solver-01-run-20261121-nomor-ly/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/malik2112/sokoban-solver-01-run-20261121-nomor-ly/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver for make.fun's hallway-and-rooms levels. `solve.js` parses each XSB level, splits it into rooms by cutting the hallway row's dead squares, solves every room with a breadth-first search over pushes (player reachability normalised to its lowest square, dead-square and frozen-2x2 pruning), and walks the player through the hallway between rooms, so the pushes add up to the level optimum P*. `main.ts` is the harness driver: it reads `/input/<id>/level.txt` for every instance and writes `/output/<id>/solution.txt` in LURD moves. The search is budgeted by states, never by the clock, and is fully deterministic.

## Run it

```sh
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=6ph5vyc7&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
