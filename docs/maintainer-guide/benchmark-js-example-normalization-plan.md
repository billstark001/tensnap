# Benchmark JS Example Normalization Plan

## Overview

This document describes the normalization effort applied to the
`packages/benchmark` package so that all five benchmark cases export their
parameter variations through a single, uniform interface.

---

## Motivation

The benchmark package contains five cases that test different parts of the
TenSnap web core:

| Case file | What it benchmarks |
|---|---|
| `cases/lineChart.ts` | `LineChartView` with random multi-line data |
| `cases/particleBounce.ts` | `EnvironmentView` with N free-flying particles |
| `cases/springGraph.ts` | `EnvironmentView` with a d3-force spring graph |
| `cases/schellingModel.ts` | Schelling Segregation Model via `web-models` |
| `cases/wolfSheepModel.ts` | Wolf-Sheep Predation Model via `web-models` |

Before this normalization, the first three cases exported their parameter
variations through `cases/variations.ts` using the `CaseVariation` interface,
while the Schelling and Wolf-Sheep model cases exported plain `BenchmarkCase[]`
arrays.  This inconsistency meant:

- `getAllVariations()` returned only three of the five suites.
- `App.tsx` contained duplicate dispatch logic to handle the two model cases
  separately from the rest.
- Adding a new benchmark case required changes in at least three places.

---

## `CaseVariation` Interface

The canonical export type for every benchmark suite is `CaseVariation`,
defined in `src/types.ts`:

```typescript
export interface CaseVariation {
  /** Short identifier used to match enable signals (e.g. 'LineChart'). */
  name: string;
  /** Human-readable description shown in the UI. */
  description: string;
  /**
   * Ordered list of cases, typically from lightest to heaviest.
   * Index 1 is the default "medium" configuration used in single-run mode.
   */
  cases: BenchmarkCase[];
}
```

### Design constraints

- **`name` must be unique** across all registered variations and must match the
  key used in `App.tsx`'s `enabledMap`.
- **Index 1 is the medium default**: single-run mode picks `cases[1]`.  Every
  suite should therefore have at least two entries (light and medium), with
  heavier configs at higher indices.
- **`CaseVariation` is defined in `types.ts`**, not in `variations.ts`, so that
  individual case files can import it without creating circular dependencies.

---

## Changes Made

### `src/types.ts`

Added the `CaseVariation` interface alongside the existing `BenchmarkCase` and
`BenchmarkStats` types.

### `cases/schellingModel.ts`

Changed the `schellingVariations` export from a raw `BenchmarkCase[]` array to
a `CaseVariation` object:

```typescript
// Before
export const schellingVariations = [ createSchellingCase({...}), ... ];

// After
export const schellingVariations: CaseVariation = {
  name: 'Schelling',
  description: 'Schelling Segregation Model with varying grid sizes and agent counts',
  cases: [ createSchellingCase({...}), ... ],
};
```

### `cases/wolfSheepModel.ts`

Same change as above for `wolfSheepVariations`:

```typescript
// Before
export const wolfSheepVariations = [ createWolfSheepCase({...}), ... ];

// After
export const wolfSheepVariations: CaseVariation = {
  name: 'WolfSheep',
  description: 'Wolf-Sheep Predation Model with varying world sizes and animal counts',
  cases: [ createWolfSheepCase({...}), ... ],
};
```

### `cases/variations.ts`

- Removed the local `CaseVariation` interface definition and replaced it with
  a re-export from `../types`.
- Imported `schellingVariations` and `wolfSheepVariations` from their
  respective files.
- Extended `getAllVariations()` to return all five suites:

```typescript
export function getAllVariations(): CaseVariation[] {
  return [
    lineChartVariations,
    particleBounceVariations,
    springGraphVariations,
    schellingVariations,
    wolfSheepVariations,
  ];
}
```

### `App.tsx`

Replaced the five separate `if` branches (plus the two separate model loops)
with a single `enabledMap` lookup and two unified loops:

```typescript
// Map each variation name to its enable signal
const enabledMap: Record<string, boolean> = {
  'LineChart': enableLineChart.value,
  'ParticleBounce': enableParticle.value,
  'SpringGraph': enableSpring.value,
  'Schelling': enableSchelling.value,
  'WolfSheep': enableWolfSheep.value,
};

if (enableVariations.value) {
  // All parameter variations of every selected suite
  for (const variation of getAllVariations()) {
    if (enabledMap[variation.name]) {
      cases.push(...variation.cases);
    }
  }
} else {
  // Single default (medium, index 1) configuration of each selected suite
  for (const variation of getAllVariations()) {
    if (enabledMap[variation.name] && variation.cases.length > 1) {
      cases.push(variation.cases[1]);
    }
  }
}
```

---

## Adding a New Benchmark Case

To add a new case after this normalization:

1. Create `cases/myNewCase.ts` and export a `CaseVariation` object with a
   unique `name`, a short `description`, and at least two entries in `cases`
   (light at index 0, medium at index 1).
2. Import the new variation in `cases/variations.ts` and append it to the
   array returned by `getAllVariations()`.
3. Add an enable signal in `App.tsx` (`enableMyNewCase`) and add it to
   `enabledMap` with the matching `name` string.
4. Add the corresponding checkbox to the `ConfigPanel` component.
5. Add the signal to the `PersistedConfig` interface, `DEFAULTS`, `loadConfig`,
   `saveConfig`, and `resetConfig` helpers.

No other files need to be touched.

---

## Acceptance Criteria

- `getAllVariations()` returns exactly five `CaseVariation` objects covering
  all benchmark suites.
- Each `CaseVariation` has a unique `name`, a non-empty `description`, and at
  least two `cases`.
- `App.tsx` dispatch loops iterate only over `getAllVariations()`.
- TypeScript compilation (`pnpm --filter @tensnap/benchmark typecheck`) passes
  with no errors.
