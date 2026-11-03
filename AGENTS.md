# AGENTS.md

Single-package browser game: React 19 + TypeScript 7 + Vite 8 + Vitest 5. UI, comments, docs, and test names are Chinese — write new ones in Chinese and update Chinese string assertions when changing messages.

Read `README.md` for the feature tour, but treat code and generated baseline files as authoritative. `docs/README.md` is the documentation index.

## Commands

```bash
npm install
npm run dev        # game at /; map studio at /map-studio.html
npm run typecheck
npm test           # full suite, both vitest projects
npx vitest run --project unit tests/map.spec.ts        # single node test
npx vitest run --project ui tests/ui.smoke.spec.tsx    # single jsdom/UI test
npm run build      # tsc --noEmit + vite build
npm run verify     # typecheck + tests + baseline/map/contrast checks + build
```

- There is no lint or formatter script. `.editorconfig` defines 2-space, LF, final newline.
- `tsconfig.json` includes only `src`, `tests`, and `vite.config.ts`; `scripts/*.ts` are **not** typechecked by `npm run typecheck`/`build`.
- `npm run verify` currently passes, but `map:gates` / `map:audit` still print red findings (known terrain content debt, e.g. gate bypass distances). Do not “fix” this by relaxing thresholds; see `README.md` §已知限制.
- UI tests emit harmless jsdom `HTMLCanvasElement.getContext()` warnings.

## Architecture invariants

- **One mutation path**: all game changes go through `reduce()` in `src/core/reducer.ts`. It `structuredClone`s the state, systems mutate that draft, and a failed action must return the original state unchanged. UI calls `gameStore.dispatch()`, which additionally drives audio, playtest metrics, and autosave.
- Keep `GameState` plain, structured-cloneable data — no functions or class instances. It is cloned on every action and persisted to IndexedDB.
- **Balance numbers live in `src/data/tables/balance.ts`**. Change constants there before touching `systems/formulas.ts` or combat damage; do not scatter gameplay constants back into systems.
- **Determinism**: rules use named RNG streams (`src/core/rng.ts`, `draw`/`streamFor`), never `Math.random()` or `Date.now()`. Saves store stream cursors so a run replays exactly. `Math.random`/`Date.now` in audio/studio UI are presentation-only — do not copy that pattern into rules.
- Battle code is split by responsibility under `src/systems/battle/`: `grid` (geometry/ranges), `combat` (damage), `tactics` (stratagems), `ai` (decisions only), `resolve` (post-battle). Keep the boundaries.
- Table data is validated by zod at startup (`src/data/schema.ts`): unique IDs, existing references, enum/range checks. Invalid data blocks the game from starting.
- **Save compatibility**: new state fields need defaults in `src/save/migrate.ts` plus a migration test. Bump `SAVE_VERSION` (`src/save/db.ts`) only for breaking save shapes; bump `MAP_VERSION` (`src/data/tables/geography.ts`) when map coordinates change.

## Map / data / generated files

- Terrain is deterministically generated from ~250 lon/lat control points in `src/data/tables/geography.ts`. Never hand-draw or patch the raster grid; edit geography control points or use the map studio.
- Map studio edits can be written back with `npm run map:apply` (dry-run by default; `-- --write` persists with `.bak` backups). It only writes gate/city coordinates — not rivers, mountains, or coastlines.
- After changing tables, map data, versions, or counts, regenerate dependencies in the same change:
  - `npm run baseline:doc` — rewrites the generated facts block and `docs/00-基线/项目基线.json`; `npm run verify` fails without it.
  - `npm run map:doc` — rewrites `docs/03-数据/地图数据清单.md` and the map baseline JSON.
  - `npm run table:sync` — writes the generals/gates snapshot into `核心数值总表-v2.html`; do not hand-edit that snapshot.
- **Numbers have one home**: `docs/00-基线/项目基线.md` §2. `baseline:check` asserts README/docs values match code; do not duplicate new counts elsewhere. Generated blocks and `地图数据清单` are not hand-edited.
- New design docs must be registered in `docs/README.md` §3 to count as a truth source; superseded docs go to `docs/archive/`.

## Testing notes

- Two Vitest projects: `unit` runs Node `.spec.ts`; `ui` runs jsdom `.spec.tsx` serially. New UI tests must use `.spec.tsx`.
- `unit` uses `isolate: false` for speed. Avoid module-level mutable state in tests or source; reset it explicitly if unavoidable.
- Build game states with `createGame({ playerFactionId: 'liubei', seed: 4242 })` from `src/data/tables/scenarios.ts`; always pass a fixed seed for deterministic tests.
- UI smoke tests mount the whole `App`; they need the `ResizeObserver` shim already present in `tests/ui.smoke.spec.tsx`.

## Entrypoints

- `src/main.tsx` — main game (`index.html`)
- `src/studio/main.tsx` — map studio (`map-studio.html`)
- `src/bench/main.tsx` — render benchmark (`bench.html`)
- Vite production build has only two inputs (`index.html`, `map-studio.html`). `bench.html` is served by the dev server and driven by `npm run bench:render`, not part of the build.
