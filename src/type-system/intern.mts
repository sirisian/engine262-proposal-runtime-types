import type { Arguments } from '../value.mts';
import { CheckedConvertValue } from '../abstract-ops/runtime-types.mts';
import { VectorValue, ObjectValue } from '../value.mts';
import { JSStringValue } from '../value.mts';
import { CompositeFromShape } from '../intrinsics/Composite.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { TypeRecord } from './records.mts';
import { neverType, orderKey, propertiesInKeyOrder, displayType } from './records.mts';
import { CountConstructedTypeRecord } from './budget.mts';
import { AreDisjoint, IsSubtype, SameTypeStructural } from './relations.mts';
import { OrdinaryObjectCreate, surroundingAgent, ConvertValue, SameValue, Throw, Value } from '#self';
import { RequireType } from '#self';
import {
  CreateDecimalValue, ParseDecimalDigits, DecimalFromDouble, RoundDecimalToWidth, isDecimalObject,
} from '../intrinsics/Decimal.mts';
import { NumberValue } from '../value.mts';

/**
 * proposal-runtime-types #sec-canonicalizetype and #sec-gettypeobject
 */
export type TypeObject = ObjectValue & { TypeRecord: TypeRecord };

/** A Type Object with the [[Call]] that makes `T(v)` a conversion. */
type CallableTypeObject = TypeObject & { Call(thisArgument: Value, argumentsList: Arguments): ValueEvaluator };

export function isTypeObject(value: unknown): value is TypeObject {
  // `TypeObject` is `ObjectValue & { TypeRecord }`, and BOTH halves are load
  // bearing. A typed primitive carries a [[TypeRecord]] too - that is how
  // `RuntimeTypeOf` reports the type of `(5 := uint8)` - so testing only for the
  // slot admitted every typed value here.
  //
  // The consequence was a language feature nobody wrote: a binding holding a
  // typed value could be used AS a type, so `const q: uint8 = 1; let v: q = 2;`
  // resolved `q` to `uint.<8>` while `const s: string = "a"; let v: s` did not,
  // the difference being whether the value happened to carry a record. It also
  // crashed the host for `decimal128`. A type position names a type; a value
  // that has one is reached with `Reflect.typeOf` or named with `type`.
  // The slot must also be FILLED. `'TypeRecord' in value` is true of a slot that
  // exists and holds nothing, which is how `decimal128` reached the walk below
  // and crashed the host on `record.Kind`.
  return value instanceof ObjectValue
    && (value as { TypeRecord?: unknown }).TypeRecord !== undefined;
}

/** #sec-canonicalizetype */
/**
 * #sec-canonicalizetype.
 *
 * #sec-type-alias-declarations admits a self-referential alias, so the record
 * handed here may be cyclic. The canonical form of a cyclic record is itself
 * cyclic, which means the copy has to be published to the walk BEFORE its
 * members are canonicalized, so that a member re-entering it lands on the copy
 * rather than starting a second one. `copies` carries the in-progress mapping;
 * each branch that builds a new record for a compound kind allocates it empty,
 * records it, then fills it.
 */
export function CanonicalizeType(t: TypeRecord, copies: Map<TypeRecord, TypeRecord> = new Map()): TypeRecord {
  const started = copies.get(t);
  if (started !== undefined) {
    return started;
  }
  if (t.Kind === 'union' || t.Kind === 'intersection') {
    // Each member is carried as the canonical record plus the record it came
    // from. The canonical form is what the union is built out of; the source is
    // what it is ordered by, because where a member is part of a cycle its
    // canonical copy is still being filled at this point - the walk is inside
    // it - so keying the copy would order this union by an empty record, and a
    // union canonicalized from a different entry point (where the same member
    // happens to be complete) could then order it differently and intern as a
    // second type. The sources are always complete here, cycles included.
    let members: { canonical: TypeRecord, source: TypeRecord }[] = [];
    for (const m of t.Members) {
      const c = CanonicalizeType(m, copies);
      if (c.Kind === t.Kind) {
        // A nested union was ordered when it was canonicalized, so its members
        // are their own sources.
        for (const nested of (c as { Members: readonly TypeRecord[] }).Members) {
          members.push({ canonical: nested, source: nested });
        }
      } else {
        members.push({ canonical: c, source: m });
      }
    }
    // Reduce by SUBSUMPTION, directionally, rather than by position.
    //
    // The old rule dropped any member a preceding one was `SameType` to, and
    // `SameType` is asymmetric for a literal against a non-literal - it answers
    // *true* for `SameType("a", string)` and *false* for `SameType(string, "a")`.
    // So `"a" | string` de-duplicated to just `"a"`, discarding the wider arm and
    // rejecting `"b"`, while `string | "a"` kept both. The same type written two
    // ways behaved differently.
    //
    // The direction matters and is opposite for the two kinds: a UNION keeps the
    // wider member, `"a" | string` being `string`; an INTERSECTION keeps the
    // narrower, `"a" & string` being `"a"`. A single "keep the wider" rule would
    // fix unions and break intersections, which today are right by accident.
    const subsumes = (keep: TypeRecord, drop: TypeRecord): boolean => (t.Kind === 'union'
      ? IsSubtype(drop, keep, [])
      : IsSubtype(keep, drop, []));
    members = members.filter((m, i) => !members.some((other, j) => {
      if (i === j) {
        return false;
      }
      if (!subsumes(other.canonical, m.canonical)) {
        return false;
      }
      // Mutually subsuming members are the same type; keep the first so that a
      // genuine duplicate still collapses to one.
      return !subsumes(m.canonical, other.canonical) || j < i;
    }));
    if (t.Kind === 'intersection' && members.some((m) => m.canonical.Kind === 'union' && m.canonical.Members.length === 0)) {
      return neverType;
    }
    // #sec-canonicalizetype: an intersection two of whose members are DISJOINT
    // has no values, and is the empty union.
    //
    // The step above is the special case where a member is ALREADY `never`; this
    // is the general one, and it is what makes `never` the single uninhabited
    // type rather than one of many. Without it `number & bigint` interned as its
    // own Type Object: uninhabited by #sec-narrowto's own reasoning, with no
    // default value and no assignable source, and yet not `never` and not even
    // assignable TO `never` - two empty types the relation could not equate.
    //
    // It also removes a dead arm from a union that contains one, since flattening
    // then drops the `never`: `string | (number & bigint)` is `string`, so a slot
    // of that type is monomorphic instead of a two-arm union an engine would tag.
    //
    // Disjointness is decided on the BASE (AreDisjoint), so the layered brands of
    // #sec-brands - two parameterizations of ONE primitive - are untouched.
    if (t.Kind === 'intersection'
      && members.some((m, i) => members.some((other, j) => i !== j && AreDisjoint(m.canonical, other.canonical)))) {
      return neverType;
    }
    if (members.length === 1) {
      return members[0].canonical;
    }
    const keys = new Map(members.map((m) => [m, orderKey(m.source)]));
    members.sort((a, b) => ((keys.get(a) ?? '') < (keys.get(b) ?? '') ? -1 : 1));
    return { Kind: t.Kind, Members: members.map((m) => m.canonical) };
  }

  if (t.Kind === 'tuple') {
    return { Kind: 'tuple', Elements: t.Elements.map((e) => ({ Type: CanonicalizeType(e.Type, copies), Rest: e.Rest, Initial: e.Initial })) };
  }
  if (t.Kind === 'application') {
    // PLAN-where-on-methods.md, unblocking D1, step 4. #sec-canonicalizetype:
    // "If _t_.[[Kind]] is ~application~ … for each element _a_ of
    // _t_.[[Arguments]], if _a_ is a Type Record append CanonicalizeType(_a_),
    // else append _a_."
    //
    // Interning is what makes IDENTITY the relation the kind is compared by:
    // "two mentions of one deferred call are one type by interning, and two
    // different calls are unrelated until they evaluate". Without this the
    // subtype arm's `s.Builder === t.Builder` would hold while the argument
    // lists compared unequal for two spellings of the same call.
    return {
      Kind: 'application',
      Builder: t.Builder,
      // The facts intern WITH the record, so two mentions of one contract call
      // carry one fact list rather than two equal ones.
      Facts: t.Facts,
      Arguments: t.Arguments.map((a) => (
        a && typeof a === 'object' && 'Kind' in a
          ? CanonicalizeType(a as TypeRecord, copies)
          : a
      )),
    } as TypeRecord;
  }
  if (t.Kind === 'array') {
    return { Kind: 'array', Element: CanonicalizeType(t.Element, copies), Extent: t.Extent };
  }
  if (t.Kind === 'reference') {
    return { Kind: 'reference', Target: CanonicalizeType(t.Target, copies) };
  }
  if (t.Kind === 'shared') {
    return { Kind: 'shared', Target: CanonicalizeType(t.Target, copies) };
  }
  if (t.Kind === 'literal') {
    return { Kind: 'literal', Value: t.Value, Base: CanonicalizeType(t.Base, copies) };
  }
  if (t.Kind === 'parameterized') {
    return { Kind: 'parameterized', Base: CanonicalizeType(t.Base, copies), Metadata: t.Metadata };
  }
  if (t.Kind === 'primitive') {
    return { Kind: 'primitive', Name: t.Name, Arguments: t.Arguments.map((a) => (typeof a === 'number' ? a : CanonicalizeType(a, copies))) };
  }
  // proposal-runtime-types: an object's property and index-signature types are
  // themselves canonicalized, so a union or intersection nested in a property is
  // sorted and deduplicated the same way a standalone one is. Without this, a
  // property union built by makeType and the same union written in source could
  // carry their members in different orders and, because SameType compares union
  // members position-wise over the canonical form, intern as distinct types.
  if (t.Kind === 'object') {
    // Published empty and filled after, so a property whose type reaches this
    // record again - which #sec-type-alias-declarations allows through a
    // reference position - lands on THIS copy rather than starting a second
    // walk that would never end. The result is a canonical form that is cyclic
    // exactly where the record it came from was.
    const copy = { Kind: 'object', Properties: [], IndexSignatures: [] } as unknown as {
      Kind: 'object',
      Properties: unknown[],
      IndexSignatures: unknown[],
    };
    copies.set(t, copy as unknown as TypeRecord);
    // #sec-sameobjecttype: "Canonicalization orders the [[Properties]] of an
    // ~object~ Type Record by key, which is what allows the interning of
    // #sec-gettypeobject to give them one Type Object, and orders the
    // [[IndexSignatures]] by the fixed total order on their [[KeyType]]s."
    //
    // Sorted as the properties are ASSIGNED rather than by reordering the
    // published copy afterwards: the copy is published empty so that a member
    // reaching this record again lands on it, and a cyclic member must not be
    // able to observe a half-sorted list.
    //
    // What a program sees change is reflection, and the clause settles that
    // deliberately: "interning merges every spelling of a type into one object,
    // so a non-canonical order would be the first spelling's, an accident of
    // module load order ... A reflected object type lists its properties in key
    // order whatever order the source wrote."
    copy.Properties = propertiesInKeyOrder(
      t.Properties.map((p) => ({ key: p.key, type: CanonicalizeType(p.type, copies), optional: p.optional, readonly: p.readonly })),
    );
    copy.IndexSignatures = t.IndexSignatures
      .map((ix) => ({ Key: CanonicalizeType(ix.Key, copies), Value: CanonicalizeType(ix.Value, copies) }))
      .sort((a, b) => {
        const ka = orderKey(a.Key);
        const kb = orderKey(b.Key);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    return copy as unknown as TypeRecord;
  }
  // A function's parameter, return, and this types are canonicalized for the same
  // reason. [[ThisType]] is preserved as ~none~ (null) where absent.
  if (t.Kind === 'function') {
    return {
      Kind: 'function',
      Signatures: t.Signatures.map((g) => ({
        Parameters: g.Parameters.map((p) => ({ ...p, Type: CanonicalizeType(p.Type, copies) })),
        Return: g.Return === null ? null : CanonicalizeType(g.Return, copies),
        ThisType: g.ThisType === undefined || g.ThisType === null ? g.ThisType : CanonicalizeType(g.ThisType, copies),
        // #sec-declared-narrowing: a signature's [[Narrows]] is part of what it
        // IS, so it survives canonicalization as [[ThisType]] does. This rebuild
        // is field by field, so a field omitted here is silently dropped from
        // every interned type - which is what happened to a constructed
        // signature's narrowings: they were built, and then canonicalization
        // returned a copy without them.
        Narrows: g.Narrows === undefined ? undefined : g.Narrows.map((nw) => ({ Target: nw.Target, Type: CanonicalizeType(nw.Type, copies) })),
      })),
    };
  }
  return t;
}

// The intern table is a property of a heap; engine262's Agent plays that
// part, so the table is keyed by the surrounding agent.
const internTables = new WeakMap<object, TypeObject[]>();

/** #sec-gettypeobject */
export function GetTypeObject(t: TypeRecord, realm?: { readonly Intrinsics: { readonly '%Type.prototype%': ObjectValue } }): TypeObject {
  const canonical = CanonicalizeType(t);
  const agent = surroundingAgent as unknown as object;
  let table = internTables.get(agent);
  if (!table) {
    table = [];
    internTables.set(agent, table);
  }
  for (const existing of table) {
    // STRUCTURAL identity, not mutual assignability: two records that denote the
    // same values may still carry different metadata claims, and interning them
    // together loses one.
    if (SameTypeStructural(existing.TypeRecord, canonical)) {
      // proposal-runtime-types: a class's type may be interned BEFORE the class
      // is initialized. A hoisted `type Alias = A;` resolves `A` through the
      // declaration (which #sec-compile-time-evaluability requires, since type
      // evaluation "reads declarations rather than run-time bindings"), and
      // that record carries no [[Constructor]] because the class has none yet.
      // Identity is by [[Declaration]], so the class's own completion asks for
      // the SAME type and gets that earlier record back - stripping the class
      // of its constructor, and with it of its layout and its membership test.
      //
      // Verified as an ordinary-code bug, not a corner: `class A { x: float32 }`
      // followed by `type Alias = A;` left `A` with no byteLength at all.
      //
      // The later, more complete record COMPLETES the earlier one rather than
      // replacing it, so every reference already handed out stays valid - which
      // is what interning is for.
      const known = existing.TypeRecord as { Constructor?: unknown };
      const supplied = canonical as { Constructor?: unknown };
      if (known.Constructor === undefined && supplied.Constructor !== undefined) {
        known.Constructor = supplied.Constructor;
      }
      return existing;
    }
  }
  // proposal-runtime-types (README "Enums"): "enumeration objects share a
  // common prototype, written here as %Enum.prototype%". It inherits from
  // %Type.prototype%, so an enum keeps everything a Type Object has and gains
  // the enumeration surface on top.
  const intrinsics = (realm ?? surroundingAgent.currentRealmRecord).Intrinsics as {
    readonly '%Type.prototype%': ObjectValue, readonly '%Enum.prototype%'?: ObjectValue,
  };
  const isEnum = canonical.Kind === 'nominal' && canonical.EnumMembers !== undefined;
  const proto = (isEnum && intrinsics['%Enum.prototype%']) || intrinsics['%Type.prototype%'];
  // #sec-evaluation-budget counts CONSTRUCTED Type Records, so the count sits
  // after the intern-table lookup above: a type that was already interned is
  // not constructed again, and charging for it would make the budget depend on
  // how often a program mentions a type rather than on how many it builds.
  CountConstructedTypeRecord();
  const obj = OrdinaryObjectCreate(proto, ['TypeRecord']) as unknown as TypeObject;
  obj.TypeRecord = canonical;
  // proposal-runtime-types (spec sec-conversions, sec-enums): a Type Object is
  // callable. A call on a plain type is an explicit conversion of the argument to
  // that type, `uint8(v)`, the same operation as `v := uint8`. A call on an enum
  // type is the reverse conversion: `Count(n)` returns the enumerator whose
  // underlying value is `n`, and is a TypeError when `n` is not one of them. The
  // conversion and the enum lookup are read from the barrel at call time, so the
  // interned object gains a [[Call]] without a load-time cycle, and its identity in
  // the intern table is unchanged.
  (obj as CallableTypeObject).Call = function* Call(_thisArgument: Value, argumentsList: Arguments): ValueEvaluator {
    const arg: Value = argumentsList[0] ?? Value.undefined;
    const record = (this as TypeObject).TypeRecord;
    // proposal-runtime-types `sec-composite-typeobject-call`: "Calling the Type
    // Object of a composite type over a shape S ... returns the result of
    // CompositeFromShape(S, source). This is the CONSTRUCTION BOUNDARY of the
    // composite types, as calling any parameterized Type Object is its type's."
    // So the typed creation is not a new call form - it is this one, given a
    // composite type.
    if (record.Kind === 'primitive' && record.Name === 'Composite' && record.Arguments.length > 0) {
      return Q(yield* CompositeFromShape(record.Arguments[0] as TypeRecord, arg));
    }
    // proposal-runtime-types #sec-vector-types: calling a vector Type Object
    // builds a vector, and it is the ONE call form here that reads more than
    // one argument - a vector's values are "the sequences of N values of T", so
    // the lanes arrive as N arguments. One argument is the broadcast cast of
    // #sec-vector-lanes and fills every lane; N arguments give the lanes in
    // order; any other count is refused.
    if (record.Kind === 'primitive' && record.Name === 'vector' && record.Arguments.length === 2) {
      const laneType = record.Arguments[0] as TypeRecord;
      const laneCount = record.Arguments[1];
      if (typeof laneCount === 'number') {
        const supplied = argumentsList.length;
        if (supplied !== laneCount && supplied !== 1) {
          return Throw.TypeError(
            '$1 lanes were supplied where $2 are wanted',
            Value(String(supplied)),
            Value(String(laneCount)),
          );
        }
        const lanes: Value[] = [];
        for (let i = 0; i < laneCount; i += 1) {
          const source = supplied === 1 ? arg : (argumentsList[i] ?? Value.undefined);
          lanes.push(Q(yield* RequireType(source, laneType)) as Value);
        }
        return new VectorValue(lanes, record);
      }
    }
    if (record.Kind === 'nominal' && record.EnumMembers !== undefined) {
      // #sec-enums: "calling the enum type with a value of the underlying type
      // returns the enumerator whose value it is". The argument is converted to
      // the underlying type FIRST, so the comparison is between two values of
      // one type. Comparing before converting made `E(1)` fail once the
      // enumerators carried their type: the stored `1` was a `uint8` and the
      // argument an untyped Number, which SameValue distinguishes.
      const converted = record.Underlying !== undefined
        ? Q(yield* CheckedConvertValue(arg, record.Underlying))
        : arg;
      // An enumerator's runtime type is its ENUM, so the stored value and the
      // converted argument carry different Type Records and SameValue tells
      // them apart. Compare what they hold: both are values of the underlying
      // type, which is the sense in which one IS the other.
      const held = (v: Value) => ((v as unknown as { numberValue?: () => number }).numberValue
        ? (v as unknown as { numberValue(): number }).numberValue()
        : undefined);
      const wanted = held(converted);
      for (const member of record.EnumMembers) {
        const hasSameContent = wanted !== undefined && held(member) === wanted;
        if (hasSameContent || SameValue(converted, member)) {
          return member;
        }
      }
      return Throw.TypeError('$1 is not a value of this enum', arg);
    }
    // proposal-runtime-types (PLAN-decimal.md stage A): calling a decimal Type
    // Object with a STRING reads a decimal from its digits. That is where a
    // cohort member comes from - "a decimal type reads its cohort member from
    // the SOURCE TEXT rather than from the mathematical value, since `1.0` and
    // `1.00` have the same mathematical value" - so a string is the only
    // argument that can carry one today.
    //
    // A NUMBER is deliberately not accepted: `decimal128(0.1)` would have to
    // choose a cohort member for a binary double whose exact expansion is 55
    // digits, which the specification flags as the hard conversion and which
    // stage F owns. The existing "not assignable" TypeError is the right answer
    // until it is defined.
    if (record.Kind === 'primitive' && (record.Name === 'decimal32' || record.Name === 'decimal64' || record.Name === 'decimal128')) {
      const width = record.Name === 'decimal32' ? 32 : record.Name === 'decimal64' ? 64 : 128;
      if (arg instanceof JSStringValue) {
        const digits = ParseDecimalDigits(arg.stringValue());
        if (!digits) {
          return Throw.SyntaxError('$1 is not a decimal', arg);
        }
        return CreateDecimalValue(digits.significand, digits.exponent, width, surroundingAgent.currentRealmRecord);
      }
      // A NUMBER converts by CARRYING WHAT THE FLOAT HOLDS (PLAN-decimal.md
      // stage F, settled by decimal.md): the exact binary expansion, rounded to
      // the width's digits. `decimal128(0.1)` is therefore NOT
      // `decimal128('0.1')` - the first carries the binary approximation the
      // double already was, and the second is exactly one tenth.
      //
      // Making them equal would be the tempting choice and the wrong one: it
      // would launder a binary approximation into an exact-looking decimal and
      // hide the whole reason these types exist.
      if (arg instanceof NumberValue) {
        const parts = DecimalFromDouble((arg as NumberValue).numberValue(), width);
        if (!parts) {
          return Throw.RangeError('$1 has no decimal value', arg);
        }
        return CreateDecimalValue(parts.significand, parts.exponent, width, surroundingAgent.currentRealmRecord);
      }
      if (isDecimalObject(arg)) {
        // A decimal to a decimal of another WIDTH re-rounds to that width's
        // precision and keeps its cohort member where it fits.
        const parts = RoundDecimalToWidth(arg, width);
        return CreateDecimalValue(parts.significand, parts.exponent, width, surroundingAgent.currentRealmRecord);
      }
    }
    return Q(yield* ConvertValue(arg, record));
  };
  table.push(obj);
  return obj;
}

/**
 * The refusal for `DefaultValueOf(_t_)` being ~none~: "It is a type error to
 * declare a binding or a field with a type _t_ and no initializer when
 * DefaultValueOf(_t_) is ~none~."
 *
 * Shared by the five sites that raise it, because both faults below were the
 * same expression written five times.
 *
 * It CANONICALIZES before displaying. An annotation resolved inline reaches
 * these sites as an un-interned record, so an empty intersection was named by
 * its members rather than by what it denotes: `let x: N & uint8` reported
 * `"string.<{ brand: "E" }>.<{ brand: "N" }> & uint.<8>"` while the same type
 * behind an alias reported `"never"`. One type, two spellings, two messages.
 *
 * And it does not tell a program to do the impossible. `never` has no default
 * because it has NO VALUES, so "a declaration of it needs an initializer" names
 * a remedy that cannot exist - there is no expression of type `never` to write.
 * The advice was actively wrong in exactly the case the empty-intersection rule
 * makes reachable, which is where a reader is most likely to meet it.
 */
export function NoDefaultValueError(record: TypeRecord) {
  const canonical = CanonicalizeType(record, new Map());
  const isNever = canonical.Kind === 'union' && canonical.Members.length === 0;
  if (isNever) {
    return Throw.TypeError('$1 has no values, so no declaration of it can be initialized', Value(displayType(canonical)));
  }
  return Throw.TypeError('$1 has no default value, so a declaration of it needs an initializer', Value(displayType(canonical)));
}
