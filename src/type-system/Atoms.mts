import type { ParseNode } from '../parser/ParseNode.mts';
import { JSStringValue, NumberValue, type Value } from '../value.mts';
import { R } from '../abstract-ops/all.mts';
import type { TypeRecord } from './records.mts';
import { DenotedUnionOf, DiscriminatingChainOf } from './DiscriminatingChain.mts';

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
  /** How the atom is identified when comparing coverage, and named in a diagnostic. */
  readonly key: string;
  /** The atom's own type, which a clause's pattern must be a supertype of. */
  readonly type: TypeRecord;
  /**
   * The declaration the atom stands for, where it has one - an enum's
   * declaration, or a sealed class's subclass.
   *
   * Coverage over these is compared by DECLARATION IDENTITY rather than by key,
   * because two classes may share a name across modules. The key remains what a
   * diagnostic prints.
   */
  readonly declaration?: ParseNode;
  /** The type the atom belongs to, named in a diagnostic - an enum's name. */
  readonly owner?: string;
}

/** `~none~`: the type is an open universe and a `match` over it needs a default. */
export const NO_ATOMS: readonly Atom[] = [];

/**
 * A literal Type Record's value as text.
 *
 * NARROWED with `instanceof` rather than probed structurally. A structural probe
 * - `typeof v.numberValue === 'function'` - reads as a duck-type to the
 * compiler, so `R` does not typecheck against it, and the project's
 * `mathematical-value` lint rule requires `R` over `.numberValue()`. **The rule
 * and the compiler disagreed only because the value was loosely typed**; typing
 * it properly satisfies both, where either substitution alone breaks the other.
 */
function literalText(value: Value): string {
  if (value instanceof JSStringValue) {
    return value.stringValue();
  }
  if (value instanceof NumberValue) {
    return String(R(value));
  }
  return String(value);
}

function literalKey(value: unknown): string {
  // The SAME unwrapping the constants need. Without it every branch atom keyed
  // as `[object Object]` and the two members of a two-member union were ONE key
  // - so coverage could not have told them apart, and a `match` covering only
  // the first would have looked exhaustive.
  const text = literalText(value as Value);
  return typeof value === 'string' ? `"${value}"` : `"${text}"`;
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
  /** A sealed class's direct subclasses, which the checker owns. */
  sealedSubclassesOf?: (t: TypeRecord) => readonly { name: string, declaration: ParseNode }[] | undefined,
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
      const rec = t as {
        EnumMembers?: readonly unknown[],
        Declaration?: {
          type?: string,
          BindingIdentifier?: { name?: string },
          EnumMemberList?: readonly { IdentifierName?: { name?: string } }[],
        },
      };
      // **An enum's atoms are its enumerators, BY NAME.** An earlier draft keyed
      // them positionally off `LibraryName`, which is *undefined* for an enum -
      // so the keys were `enum.0`, `enum.1`, which count correctly and print
      // uselessly. The names are on the declaration, which the record carries.
      if (Array.isArray(rec.EnumMembers) && rec.Declaration?.type === 'EnumDeclaration') {
        const owner = rec.Declaration.BindingIdentifier?.name;
        const names = (rec.Declaration.EnumMemberList ?? [])
          .map((m) => m.IdentifierName?.name)
          .filter((n): n is string => typeof n === 'string');
        if (names.length > 0) {
          return names.map((name) => ({
            key: name, type: t, declaration: rec.Declaration as ParseNode, owner,
          }));
        }
      }
      // A SEALED class's atoms are its direct subclasses, which live in a map the
      // checker owns - so the caller supplies them, the way it supplies a
      // dependent record type's denotation.
      const subclasses = sealedSubclassesOf?.(t);
      if (subclasses && subclasses.length > 0) {
        return subclasses.map((sub) => ({
          key: sub.name, type: t, declaration: sub.declaration,
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
        const inner = Atoms(member, denotedUnionOf, sealedSubclassesOf);
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
      return denoted ? Atoms(denoted, denotedUnionOf, sealedSubclassesOf) : NO_ATOMS;
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
      return Atoms({ Kind: 'union', Members: distributed } as TypeRecord, denotedUnionOf, sealedSubclassesOf);
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

/**
 * The atoms of a type that may be a dependent record type, resolving its chain.
 *
 * This is the caller `Atoms` was written for. A dependent record type reaches
 * the checker as a `nominal` record carrying its `Declaration` and its
 * `Structure`, so everything the denotation needs is on the record: the
 * `WhereClauses` from the declaration, the base object type from the structure,
 * and the discriminant's declared constants from the base's member type.
 */
export function AtomsOfType(t: TypeRecord | undefined): readonly Atom[] {
  const direct = Atoms(t);
  if (direct.length > 0 || !t || t.Kind !== 'nominal') {
    return direct;
  }
  const rec = t as {
    Declaration?: { WhereClauses?: readonly ParseNode[] },
    Structure?: TypeRecord,
  };
  const clauses = rec.Declaration?.WhereClauses ?? [];
  const base = rec.Structure;
  if (clauses.length === 0 || !base || base.Kind !== 'object') {
    return NO_ATOMS;
  }
  for (const clause of clauses) {
    const chain = DiscriminatingChainOf(clause);
    if (!chain) {
      continue;
    }
    // The discriminant's declared constants come from its own member type: a
    // union of literals, which is the only shape the chain qualifies over.
    const member = base.Properties.find((prop) => prop.key === chain.discriminant);
    const constants = literalConstantsOf(member?.type);
    if (constants === undefined) {
      continue;
    }
    const denoted = DenotedUnionOf(chain, base, constants, (k) => literalFor(member!.type, k));
    if (denoted) {
      return Atoms(denoted);
    }
  }
  return NO_ATOMS;
}

/**
 * A type-record literal's value as the string stage A produced from the PARSE
 * TREE.
 *
 * **The two sides spell a constant differently**: stage A reads a
 * `StringLiteral` node and gets `US`, while a `literal` Type Record carries an
 * engine `Value`, whose `String(...)` is `[object Object]`. They never matched,
 * and every denotation came back empty — the constants were compared, found
 * unequal, and the chain reported as non-total rather than as mis-read.
 */

/** The constants of a union of literals, or *undefined* where it is not one. */
function literalConstantsOf(t: TypeRecord | undefined): readonly string[] | undefined {
  if (!t || t.Kind !== 'union') {
    return undefined;
  }
  const members = (t as { Members: readonly TypeRecord[] }).Members;
  const out: string[] = [];
  for (const m of members) {
    if (m.Kind !== 'literal') {
      return undefined;
    }
    out.push(literalText((m as { Value: Value }).Value));
  }
  return out.length > 1 ? out : undefined;
}

/** The literal member of a union whose value is `constant`. */
function literalFor(t: TypeRecord, constant: string): TypeRecord | undefined {
  if (t.Kind !== 'union') {
    return undefined;
  }
  return (t as { Members: readonly TypeRecord[] }).Members
    .find((m) => m.Kind === 'literal' && literalText((m as { Value: Value }).Value) === constant);
}
