import type { StoredPlanDiffPayload } from '@workout/contracts';
import type { PlanDiff } from '@workout/domain';

/**
 * Compile-time agreement between the domain's PlanDiff types and the contracts
 * package's wire schema.
 *
 * This lives in INCLUDED source on purpose. It used to sit in a `*.test.ts` file,
 * which every tsconfig excludes and vitest merely strips of types, so the assertion
 * that claimed "`pnpm typecheck` fails here" was never checked by anything - a
 * deliberate type error in that file still passed. Here, `tsc --build` evaluates it on
 * every `pnpm typecheck`.
 *
 * It compares the stored-proposal schema, where names are optional as in the domain; the
 * agent-input schema only tightens that by requiring them.
 *
 * The check is structural EQUALITY, not mutual assignability. Assignability is too
 * weak for drift detection: adding an optional field on one side leaves both sides
 * assignable to each other, so a nested schema could quietly accept a field the domain
 * never models.
 *
 * Two representational differences are normalised away before comparing, because they
 * are not drift:
 *   - the domain marks everything `readonly`, while zod infers mutable types;
 *   - under `exactOptionalPropertyTypes`, zod infers `field?: T | undefined` where the
 *     domain declares `field?: T`.
 */

/** Strips `readonly` from properties and arrays, recursively. */
type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

/** Removes `undefined` from optional property values, keeping them optional. */
type ExactOptional<T> = T extends readonly (infer Item)[]
  ? ExactOptional<Item>[]
  : T extends object
    ? { [Key in keyof T]: ExactOptional<Exclude<T[Key], undefined>> }
    : T;

type Normalised<T> = ExactOptional<DeepMutable<T>>;

/**
 * True only when A and B are identical types. Unlike `A extends B`, this distinguishes
 * an extra optional property, a narrower literal, and a changed union member.
 */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type WireEqualsDomain = Equals<Normalised<StoredPlanDiffPayload>, Normalised<PlanDiff>>;

/**
 * Fails `pnpm typecheck` if the wire schema and the domain type differ in any operation,
 * field, nested field, optionality, or literal - in either direction.
 */
export const planDiffWireMatchesDomain: WireEqualsDomain = true;

/*
 * Self-tests for the helper. If `Equals` or the normalisation ever degenerated to
 * "always true" - for instance by collapsing to `any` - the agreement above would pass
 * vacuously. Each of these must stay false, or `pnpm typecheck` fails.
 */
export const equalsDetectsExtraOptionalField: Equals<{ a: string }, { a: string; b?: string }> =
  false;
export const equalsDetectsChangedFieldType: Equals<{ a: string }, { a: number }> = false;
export const equalsDetectsNarrowedLiteral: Equals<{ op: string }, { op: 'x' }> = false;
export const equalsDetectsNestedDrift: Equals<
  Normalised<{ readonly items: readonly { readonly id: string }[] }>,
  Normalised<{ items: { id: string; extra?: number }[] }>
> = false;
export const normalisationIgnoresReadonlyAndUndefined: Equals<
  Normalised<{ readonly list: readonly { readonly v?: string }[] }>,
  Normalised<{ list: { v?: string | undefined }[] }>
> = true;
