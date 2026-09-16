/**
 * Expected failures are values, not exceptions.
 *
 * A stale proposal, an out-of-range RIR, and a negative load are all ordinary
 * outcomes the caller must handle. Throwing for them makes the type system stop
 * helping exactly where the rules matter most.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/** Unwraps a result, throwing only when the caller has already proved it is Ok. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`unwrap called on an Err result: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
