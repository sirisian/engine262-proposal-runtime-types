export type TypeArgumentOrderFailure =
  | { readonly ok: false, readonly kind: 'positional-after-named' }
  | { readonly ok: false, readonly kind: 'unknown-name', readonly name: string }
  | { readonly ok: false, readonly kind: 'supplied-twice', readonly name: string }
  | { readonly ok: false, readonly kind: 'too-many' };

export type TypeArgumentOrder<T> =
  | { readonly ok: true, readonly named: boolean, readonly ordered: readonly (T | undefined)[] }
  | TypeArgumentOrderFailure;

/**
 * Orders `args` by `names` against `parameterNames`. Positional arguments are
 * exactly the leading ones; a hole in the result is a parameter nothing
 * supplied, for the caller's default handling. The result is trimmed to the
 * last supplied parameter, so trailing defaults keep the path they had.
 *
 * An application with no named argument returns the list unchanged
 * (`named: false`), so the cost of the feature falls only on those using it.
 */
export function orderTypeArguments<T>(
  parameterNames: readonly (string | undefined)[],
  args: readonly T[],
  names: readonly (string | undefined)[],
): TypeArgumentOrder<T> {
  const firstNamed = names.findIndex((n) => n !== undefined);
  if (firstNamed === -1) {
    return { ok: true, named: false, ordered: args };
  }
  for (let i = firstNamed; i < names.length; i += 1) {
    if (names[i] === undefined) {
      return { ok: false, kind: 'positional-after-named' };
    }
  }
  if (firstNamed > parameterNames.length) {
    return { ok: false, kind: 'too-many' };
  }
  const filled: (T | undefined)[] = parameterNames.map((_, i) => (i < firstNamed ? args[i] : undefined));
  for (let i = firstNamed; i < names.length; i += 1) {
    const n = names[i]!;
    const at = parameterNames.indexOf(n);
    if (at === -1) {
      return { ok: false, kind: 'unknown-name', name: n };
    }
    if (filled[at] !== undefined) {
      return { ok: false, kind: 'supplied-twice', name: n };
    }
    filled[at] = args[i];
  }
  let last = -1;
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] !== undefined) {
      last = i;
    }
  }
  return { ok: true, named: true, ordered: filled.slice(0, last + 1) };
}
