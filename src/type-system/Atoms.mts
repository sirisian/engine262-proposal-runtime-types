import type { TypeRecord } from './records.mts';

/**
 * proposal-runtime-types `sec-match-exhaustiveness`: **the atoms of a Type
 * Record.**
 *
 * The specification names seven sources and the engine implemented two - enum
 * and sealed class, each by its own path. This is the operation they were two
 * halves of, written once so a third source joins it rather than forking it
 * again.
 *
 * Exhaustiveness is over atoms, so a source with no atoms is a `match` that
 * needs a catch-all. That is the correct answer for an open universe and the
 * wrong one for a closed set, which is why five of the seven being unimplemented
 * meant five kinds of program the specification rejects being accepted.
 */

export interface Atom {
  /** How the atom is identified when comparing coverage. */
  readonly key: string;
  /** The atom's own type, which a clause's pattern must be a supertype of. */
  readonly type: TypeRecord;
}

/** `~none~`: the type is an open universe and a `match` over it needs a default. */
export const NO_ATOMS: readonly Atom[] = [];

function literalKey(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

/**
 * `Atoms(t)`.
 *
 * The order below follows the specification's, and each case is that clause's
 * words: "for an enum, its enumerators; for a sealed class, its direct
 * subclasses and, where instantiable, itself; for `boolean`, *true* and *false*;
 * for `null` and `undefined`, themselves; for a ~union~ of two or more members
 * each of which is one of the preceding, an ~object~ type, a ~tuple~ type, or a
 * composite type, the atoms of each member, an object, tuple, or composite
 * member being its own atom; for a dependent record type whose predicate is a
 * discriminating `where` chain, the atoms of the union that chain denotes; for
 * an ~intersection~ one or more of whose members is a ~union~, the atoms of the
 * union formed by distributing it".
 */
export function Atoms(
  t: TypeRecord | undefined,
  /** The denoted union of a dependent record type, where the caller found one. */
  denotedUnionOf?: (t: TypeRecord) => TypeRecord | undefined,
): readonly Atom[] {
  if (!t) {
    return NO_ATOMS;
  }
  switch (t.Kind) {
    case 'primitive': {
      // **(measured)** `boolean`, `null` and `undefined` are `primitive` records
      // carrying a `Name`, not top-level Kinds. A first draft switched on
      // `t.Kind === 'boolean'` and did not compile, which is the cheap way to
      // find this; a looser type would have made it a silent no-atoms answer.
      const name = (t as { Name?: string }).Name;
      if (name === 'boolean') {
        return [
          { key: 'true', type: { Kind: 'literal', Value: true as never, Base: t } },
          { key: 'false', type: { Kind: 'literal', Value: false as never, Base: t } },
        ];
      }
      if (name === 'null' || name === 'undefined') {
        // "for `null` and `undefined`, themselves" - each its own single atom.
        return [{ key: name, type: t }];
      }
      return NO_ATOMS;
    }
    case 'nominal': {
      const decl = t as { EnumMembers?: readonly unknown[], LibraryName?: string };
      if (Array.isArray(decl.EnumMembers)) {
        return decl.EnumMembers.map((_, i) => ({
          key: `${decl.LibraryName ?? 'enum'}.${i}`,
          type: t,
        }));
      }
      return NO_ATOMS;
    }
    case 'object':
    case 'tuple':
      // "an object, tuple, or composite member being its own atom" - which is
      // what makes the denoted union's members atoms at all.
      return [{ key: describe(t), type: t }];
    case 'literal':
      // A literal is NOT a source on its own; it is an atom only as a member of
      // a union whose other members qualify. Returning it here would make a
      // literal-typed subject exhaustively checkable, which the standing
      // decision declines.
      return NO_ATOMS;
    case 'union': {
      const members = (t as { Members: readonly TypeRecord[] }).Members;
      if (members.length < 2) {
        return NO_ATOMS;
      }
      // **"A union with a member of ~literal~ kind has atoms ~none~"** - stated
      // as its own sentence in the clause, and it is the standing decision
      // restated: "a closed set of literals that wants the check is an enum over
      // its base". So one literal member disqualifies the whole union.
      if (members.some((m) => m.Kind === 'literal')) {
        return NO_ATOMS;
      }
      const out: Atom[] = [];
      for (const member of members) {
        const inner = Atoms(member, denotedUnionOf);
        if (inner.length === 0) {
          return NO_ATOMS;
        }
        out.push(...inner);
      }
      return out;
    }
    case 'parameterized': {
      // A dependent record type: its atoms are the atoms of the union its chain
      // denotes. The caller supplies the denotation, because building it needs
      // the declaration and this operation sees only the record.
      const denoted = denotedUnionOf?.(t);
      return denoted ? Atoms(denoted, denotedUnionOf) : NO_ATOMS;
    }
    case 'intersection': {
      const members = (t as { Members: readonly TypeRecord[] }).Members;
      const unions = members.filter((m) => m.Kind === 'union');
      if (unions.length === 0) {
        return NO_ATOMS;
      }
      // "the atoms of the union formed by distributing it, one member per choice
      // of one arm from each such union intersected with the remaining members".
      const rest = members.filter((m) => m.Kind !== 'union');
      let combos: TypeRecord[][] = [[]];
      for (const u of unions) {
        const arms = (u as { Members: readonly TypeRecord[] }).Members;
        combos = combos.flatMap((c) => arms.map((a) => [...c, a]));
      }
      const distributed: TypeRecord[] = combos.map((c) => {
        const parts = [...c, ...rest];
        // An intersection of ONE is that one. Without this the distribution
        // produces single-member intersections, whose atoms are computed by the
        // intersection case again - which finds no union member and answers
        // none, so a distributable intersection had no atoms at all.
        return parts.length === 1 ? parts[0]! : ({ Kind: 'intersection', Members: parts } as TypeRecord);
      });
      return Atoms({ Kind: 'union', Members: distributed } as TypeRecord, denotedUnionOf);
    }
    default:
      // "and ~none~ otherwise", which includes a Type Object subject: "the types
      // being an open universe, so requires such a `match` to carry a catch-all".
      return NO_ATOMS;
  }
}

/** A stable key for a structural atom. */
function describe(t: TypeRecord): string {
  if (t.Kind === 'object') {
    const props = (t as { Properties: readonly { key: string | symbol, type: TypeRecord }[] }).Properties;
    return `{${props.map((p) => `${String(p.key)}:${p.type.Kind === 'literal' ? literalKey((p.type as { Value: unknown }).Value) : p.type.Kind}`).join(',')}}`;
  }
  return t.Kind;
}
