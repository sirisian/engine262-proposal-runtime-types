import { libraryTypeParameters } from './library-type-arguments.mts';
import { intrinsicParameters } from './intrinsic-generics.mts';
import { SequenceAssignment } from './sequence-assignment.mts';
export { orderTypeArguments, type TypeArgumentOrder, type TypeArgumentOrderFailure } from './type-argument-binding.mts';
import type { TypeArgumentOrderFailure } from './type-argument-binding.mts';

/**
 * proposal-runtime-types #sec-type-references: named type arguments, ordered
 * into PARAMETER order before anything is bound. This is the SYNTACTIC half of
 * BindTypeArguments: which argument goes to which parameter is decided by names
 * alone, so it lives in one pure function both resolvers share - a rule enforced
 * in one and not the other is a rule that holds in some positions, and named
 * arguments were exactly that.
 *
 * Resolution, defaults, and constraints stay with each site: they need frames
 * and left-to-right evaluation (#sec-computed-constraints) that ordering does
 * not.
 */

/**
 * Library generics carry the parameter names the specification itself writes - `Map.<K, V>`,
 * `Set.<T>` (#sec-keyed-collections), `vector.<T, N>` (#sec-vector-types),
 * `int.<N>` / `uint.<N>` (#sec-integer-types). Names are added here
 * only once verified against their clause; a name this table does not know is
 * refused rather than guessed, which is the same rule a misspelling gets.
 * A declared prelude would retire this table.
 */
export function libraryTypeParameterNames(name: string): readonly string[] | null {
  const library = libraryTypeParameters(name);
  if (library) return library.map((p) => p.Name);
  const intrinsic = intrinsicParameters(name);
  if (intrinsic) return intrinsic.map((p) => p.Name);
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

/** What `assignTypeArguments` needs to know of a parameter. */
export interface TypeArgumentSlotParam {
  readonly Name: string;
  readonly Variadic: boolean;
  readonly HasDefault: boolean;
}

export type TypeArgumentAssignment<T> =
  | { readonly ok: true, readonly runs: readonly (readonly T[])[], readonly named: ReadonlySet<number> }
  | TypeArgumentOrderFailure
  | { readonly ok: false, readonly kind: 'unmatched' }
  | { readonly ok: false, readonly kind: 'missing', readonly name: string };

/**
 * #sec-bindtypearguments, the SYNTACTIC half with variadic parameters: names
 * resolve first - a named variadic parameter opens a RUN that takes the unnamed
 * arguments after it - and the positional prefix is distributed by
 * SequenceAssignment, the rest-parameter operation, a pack being a rest slot.
 * A non-variadic slot admits by arity alone (its constraint is checked once
 * bound); a named pack admits nothing positionally; a pack's element bound is
 * the caller's `admits`. The result is one run per parameter, in order.
 */
export function assignTypeArguments<T>(
  params: readonly TypeArgumentSlotParam[],
  args: readonly T[],
  names: readonly (string | undefined)[],
  admits: (paramIndex: number, arg: T) => boolean,
): TypeArgumentAssignment<T> {
  const n = args.length;
  let firstNamed = names.findIndex((x) => x !== undefined);
  if (firstNamed === -1) {
    firstNamed = n;
  }
  const positional = args.slice(0, firstNamed);
  const named = new Map<number, T[]>();
  let i = firstNamed;
  while (i < n) {
    const nm = names[i];
    if (nm === undefined) {
      return { ok: false, kind: 'positional-after-named' };
    }
    const at = params.findIndex((q) => q.Name === nm);
    if (at === -1) {
      return { ok: false, kind: 'unknown-name', name: nm };
    }
    if (named.has(at)) {
      return { ok: false, kind: 'supplied-twice', name: nm };
    }
    const run: T[] = [args[i]!];
    i += 1;
    if (params[at]!.Variadic) {
      while (i < n && names[i] === undefined) {
        run.push(args[i]!);
        i += 1;
      }
    }
    named.set(at, run);
  }
  // A NAMED non-variadic parameter is satisfied by its name, so for the
  // positional split its slot is optional - `id.<T: uint8>` has no positional
  // argument for T and must not be 'unmatched'. (A named pack takes count 0
  // through the admits below.)
  const slots = params.map((q, j) => (q.Variadic ? { Rest: true, Optional: false } : { Rest: false, Optional: q.HasDefault || named.has(j) }));
  // A required parameter that neither a name nor the positional prefix can
  // reach is reported by NAME - the diagnostic the pack-free path gives.
  const requiredUnnamed = params.filter((q, j) => !q.Variadic && !q.HasDefault && !named.has(j));
  if (positional.length < requiredUnnamed.length) {
    return { ok: false, kind: 'missing', name: requiredUnnamed[positional.length]!.Name };
  }
  const counts = SequenceAssignment(slots, positional.length, (itemIndex, slotIndex) => {
    const q = params[slotIndex]!;
    if (!q.Variadic) {
      return true;
    }
    if (named.has(slotIndex)) {
      return false;
    }
    return admits(slotIndex, positional[itemIndex]!);
  });
  if (counts === 'unmatched') {
    return { ok: false, kind: 'unmatched' };
  }
  const runs: T[][] = [];
  let cursor = 0;
  for (let j = 0; j < params.length; j += 1) {
    let supplied = positional.slice(cursor, cursor + counts[j]!);
    cursor += counts[j]!;
    const byName = named.get(j);
    if (byName) {
      if (supplied.length > 0) {
        return { ok: false, kind: 'supplied-twice', name: params[j]!.Name };
      }
      supplied = byName;
    }
    runs.push(supplied);
  }
  return { ok: true, runs, named: new Set(named.keys()) };
}
