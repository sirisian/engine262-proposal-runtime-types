import type { ObjectValue, Arguments } from '../value.mts';
import { CompositeFromShape } from '../intrinsics/Composite.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { Q } from '../completion.mts';
import type { TypeRecord } from './records.mts';
import { neverType, orderKey } from './records.mts';
import { CountConstructedTypeRecord } from './budget.mts';
import { SameType } from './relations.mts';
import { OrdinaryObjectCreate, surroundingAgent, ConvertValue, SameValue, Throw, Value } from '#self';

/**
 * proposal-runtime-types #sec-canonicalizetype and #sec-gettypeobject
 */
export type TypeObject = ObjectValue & { TypeRecord: TypeRecord };

/** A Type Object with the [[Call]] that makes `T(v)` a conversion. */
type CallableTypeObject = TypeObject & { Call(thisArgument: Value, argumentsList: Arguments): ValueEvaluator };

export function isTypeObject(value: unknown): value is TypeObject {
  return !!value && typeof value === 'object' && 'TypeRecord' in (value as object);
}

/** #sec-canonicalizetype */
export function CanonicalizeType(t: TypeRecord): TypeRecord {
  if (t.Kind === 'union' || t.Kind === 'intersection') {
    let members: TypeRecord[] = [];
    for (const m of t.Members) {
      const c = CanonicalizeType(m);
      if (c.Kind === t.Kind) {
        members.push(...(c as { Members: readonly TypeRecord[] }).Members);
      } else {
        members.push(c);
      }
    }
    members = members.filter((m, i) => !members.slice(0, i).some((earlier) => SameType(earlier, m)));
    if (t.Kind === 'intersection' && members.some((m) => m.Kind === 'union' && m.Members.length === 0)) {
      return neverType;
    }
    if (members.length === 1) {
      return members[0];
    }
    members.sort((a, b) => (orderKey(a) < orderKey(b) ? -1 : 1));
    return { Kind: t.Kind, Members: members };
  }
  if (t.Kind === 'tuple') {
    return { Kind: 'tuple', Elements: t.Elements.map((e) => ({ Type: CanonicalizeType(e.Type), Rest: e.Rest, Initial: e.Initial })) };
  }
  if (t.Kind === 'array') {
    return { Kind: 'array', Element: CanonicalizeType(t.Element), Extent: t.Extent };
  }
  if (t.Kind === 'reference') {
    return { Kind: 'reference', Target: CanonicalizeType(t.Target) };
  }
  if (t.Kind === 'literal') {
    return { Kind: 'literal', Value: t.Value, Base: CanonicalizeType(t.Base) };
  }
  if (t.Kind === 'parameterized') {
    return { Kind: 'parameterized', Base: CanonicalizeType(t.Base), Metadata: t.Metadata };
  }
  if (t.Kind === 'primitive') {
    return { Kind: 'primitive', Name: t.Name, Arguments: t.Arguments.map((a) => (typeof a === 'number' ? a : CanonicalizeType(a))) };
  }
  // proposal-runtime-types: an object's property and index-signature types are
  // themselves canonicalized, so a union or intersection nested in a property is
  // sorted and deduplicated the same way a standalone one is. Without this, a
  // property union built by makeType and the same union written in source could
  // carry their members in different orders and, because SameType compares union
  // members position-wise over the canonical form, intern as distinct types.
  if (t.Kind === 'object') {
    return {
      Kind: 'object',
      Properties: t.Properties.map((p) => ({ key: p.key, type: CanonicalizeType(p.type), optional: p.optional, readonly: p.readonly })),
      IndexSignatures: t.IndexSignatures.map((ix) => ({ Key: CanonicalizeType(ix.Key), Value: CanonicalizeType(ix.Value) })),
    };
  }
  // A function's parameter, return, and this types are canonicalized for the same
  // reason. [[ThisType]] is preserved as ~none~ (null) where absent.
  if (t.Kind === 'function') {
    return {
      Kind: 'function',
      Signatures: t.Signatures.map((g) => ({
        Parameters: g.Parameters.map((p) => ({ ...p, Type: CanonicalizeType(p.Type) })),
        Return: g.Return === null ? null : CanonicalizeType(g.Return),
        ThisType: g.ThisType === undefined || g.ThisType === null ? g.ThisType : CanonicalizeType(g.ThisType),
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
    if (SameType(existing.TypeRecord, canonical)) {
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
    if (record.Kind === 'nominal' && record.EnumMembers !== undefined) {
      for (const member of record.EnumMembers) {
        if (SameValue(arg, member)) {
          return member;
        }
      }
      return Throw.TypeError('$1 is not a value of this enum', arg);
    }
    return Q(yield* ConvertValue(arg, record));
  };
  table.push(obj);
  return obj;
}
