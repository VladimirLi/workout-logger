# 0004 — Typed, discriminated measurement profiles

**Status:** Accepted
**Date:** 2026-09-16
**Discovery:** D-012, D-013, D-014, R-005, R-006

## Context

A bench press set, a Bulgarian split squat set, and twenty minutes on a treadmill are not
the same shape of data. Modelling them with one wide nullable row produces columns that
mean different things depending on the exercise, and validation that cannot say anything
useful.

`load: 40` is also ambiguous on a unilateral exercise: 40 kg in each hand, or 40 kg total?
Guessing wrong silently halves or doubles a year of training history. And "8" as an
exertion value is meaningless without knowing whether it is RIR, a 1–10 RPE, or Borg.

## Decision

**Discriminated profiles, not nullable columns.** Three profiles in the first slice:

- `strength` — sets, repetitions, load, exertion, notes.
- `unilateral_strength` — as above, plus explicit `side` and `load_semantics`.
- `cardio` — duration, distance, pace, incline, and cardio exertion as applicable.

Each profile is separately validated and **schema-versioned**. Not every field applies to
every profile, and the type system says so.

**Every quantity is a typed value with a unit.** Never a bare number. Canonical storage
units: kilograms, metres, seconds, kilocalories, watts, revolutions/strokes per minute,
beats per minute. Display conversion never overwrites the canonical value. Default display
is metric — kg, km, min/km.

**Unilateral records store side and load semantics explicitly.** `side` is one of `left`,
`right`, `both`, `alternating`. `load_semantics` is `per_side` or `total`. The **default
interpretation is `per_side`**, with a per-exercise override. Left and right observations
remain distinct in storage — they are never averaged into one number at rest.

**Exertion is typed by profile.**

- Strength: **RIR is the authoritative user-entered value.** The corresponding 1–10 RPE is
  **derived and read-only**. Half-step precision is allowed where the mapping supports it.
  The UI shows RIR by default.
- Cardio: a separately tagged **Borg** scale. It never shares an untyped field with
  strength exertion.
- Session-level exertion, if captured, is a distinct value. It is **not** computed by
  averaging set values.

**New profiles arrive through ordinary versioned code and schema changes** — validation,
migration, UI support, and tests. The first slice ships no plugin system and no
user-defined schemas.

## Consequences

**Good.** A stored measurement is unambiguous decades later. Validation can be precise per
profile. Adding a fourth profile is a normal, reviewable change with a known checklist.

**Bad.** Queries across profiles need explicit handling rather than one flat scan. Adding
a profile touches domain, contracts, storage, UI, and tests — there is no shortcut.

**The wire contract must not be looser than the domain.** A boundary that accepts states the
domain cannot represent is not a contract. So each measurement field accepts only its own
dimension - there is no shared, dimension-agnostic quantity schema, because one let
`load: { unit: 's' }` parse - and a payload's RPE must equal the value derived from its RIR.
Per-unit bounds are mirrored on both sides.

**Accepted cost.** Deriving RPE from RIR rather than storing both means a future change to
the mapping changes historical displayed RPE. That is correct: RIR is what the user
reported, and the mapping is an interpretation. Storing the interpretation as if it were
an observation would be the actual error.
