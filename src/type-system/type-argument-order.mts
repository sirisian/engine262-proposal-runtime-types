/**
 * proposal-runtime-types #sec-type-references: named type arguments, ordered
 * into PARAMETER order before anything is bound. This is the SYNTACTIC half of
 * BindTypeArguments (PLAN-variadic-and-named-generic-arguments.md §2.2 steps
 * 2-3): which argument goes to which parameter is decided by names alone, so it
 * lives in one pure function both resolvers share - a rule enforced in one and
 * not the other is a rule that holds in some positions (F-B), and named
 * arguments were exactly that (F-A).
 *
 * Resolution, defaults, and constraints stay with each site: they need frames
 * and left-to-right evaluation (#sec-computed-constraints) that ordering does
 * not.
 */

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

/**
 * PLAN-variadic-and-named-generic-arguments.md OQ-17 (locked): library generics
 * carry the parameter names the specification itself writes - `Map.<K, V>`,
 * `Set.<T>` (#sec-keyed-collections), `vector.<T, N>` (#sec-vector-types),
 * `int.<N>` / `uint.<N>` (#sec-parameterized-integers). Names are added here
 * only once verified against their clause; a name this table does not know is
 * refused rather than guessed, which is the same rule a misspelling gets.
 * The declared-prelude direction (OQ-17 (c)) retires this table.
 */
export function libraryTypeParameterNames(name: string): readonly string[] | null {
  switch (name) {
    case 'Map':
    case 'WeakMap':
      return ['K', 'V'];
    case 'Set':
    case 'WeakSet':
      return ['T'];
    case 'Iterable':
      return ['T'];
    case 'vector':
      return ['T', 'N'];
    case 'int':
    case 'uint':
      return ['N'];
    default:
      return null;
  }
}

/** The `ArgumentName` a named type argument's node carries (rides on the type node). */
export function typeArgumentNameOf(node: unknown): string | undefined {
  return (node as { ArgumentName?: string }).ArgumentName;
}
