import { SameValue } from '../abstract-ops/all.mts';
import { Value } from '../value.mts';
import type { ParameterRecord, TypeRecord, TupleElementRecord } from './records.mts';
import { SequenceAssignment } from './sequence-assignment.mts';
import {
  maximumSupply, parameterArgumentType, requiredArity, restElementType,
} from './records.mts';
import { builtinImplements } from './iteration-types.mts';

/**
 * proposal-runtime-types #sec-structural-identity and #sec-subtyping-and-assignability
 * Pure relations over Type Records, with assumption lists so that comparison
 * of recursive types terminates.
 */
interface Assumption { readonly First: TypeRecord, readonly Second: TypeRecord }

function assumed(assumptions: readonly Assumption[], s: TypeRecord, t: TypeRecord): boolean {
  return assumptions.some((p) => p.First === s && p.Second === t);
}

/** #sec-sametype */

/**
 * proposal-runtime-types (primitivemetadata.md): two metadata parameterizations are
 * the same type when their metadata AGREE, field for field, rather than when they
 * are the same object. Comparing by identity would have made every written
 * `float32.<{ unit: "m" }>` a fresh type, which would defeat interning: the point of
 * an interned type is that two mentions of one shape are one object.
 */
export function SameMetadata(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  // table-metadata-values: a pattern is equivalent to a pattern with identical
  // source and identical flags. This is why a pattern is carried structurally
  // rather than as a RegExp: two objects are never equal, so one pattern written
  // in two modules would otherwise be two types.
  const ap = a as { __pattern?: boolean, source?: string, flags?: string };
  const bp = b as { __pattern?: boolean, source?: string, flags?: string };
  if (ap.__pattern || bp.__pattern) {
    return ap.__pattern === bp.__pattern && ap.source === bp.source && ap.flags === bp.flags;
  }
  // table-metadata-values: a range is equivalent to a range of the same shape,
  // with the same bound at each endpoint the shape has, and SameValue at each
  // endpoint's value. Carried structurally for the same reason a pattern is.
  const ar = a as { __range?: boolean, start?: Value, end?: Value, startBound?: string, endBound?: string };
  const br = b as { __range?: boolean, start?: Value, end?: Value, startBound?: string, endBound?: string };
  if (ar.__range || br.__range) {
    if (ar.__range !== br.__range || ar.startBound !== br.startBound || ar.endBound !== br.endBound) {
      return false;
    }
    const sameEnd = (x: Value | undefined, y: Value | undefined) => (x === undefined || y === undefined ? x === y : SameValue(x, y) === true);
    return sameEnd(ar.start, br.start) && sameEnd(ar.end, br.end);
  }
  return ak.every((k) => {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (av === bv) {
      return true;
    }
    // table-metadata-values: a nested record compares by the same keys and
    // equivalent values without regard to order, and a list by length and by
    // each index in order. Object.keys gives a list's indices, so one recursion
    // serves both, with the array check above keeping the two forms apart.
    if (av && bv && typeof av === 'object' && typeof bv === 'object'
      && !('numberValue' in av) && !('stringValue' in av)) {
      return SameMetadata(av, bv);
    }
    // Field values are Values, whose sameness is their own; a literal String or
    // Number Value compares by the value it holds.
    const an = (av as { numberValue?(): number, stringValue?(): string });
    const bn = (bv as { numberValue?(): number, stringValue?(): string });
    /* eslint-disable @engine262/mathematical-value -- R asserts a NumberValue, and a metadata field may be a String or any other literal Value */
    if (an?.numberValue && bn?.numberValue) {
      return an.numberValue() === bn.numberValue();
    }
    if (an?.stringValue && bn?.stringValue) {
      return an.stringValue() === bn.stringValue();
    }
    /* eslint-enable @engine262/mathematical-value */
    return false;
  });
}

export function SameType(s: TypeRecord, t: TypeRecord): boolean {
  return SameTypeWithAssumptions(s, t, []);
}

function sameArgument(a: TypeRecord | number, b: TypeRecord | number, assumptions: readonly Assumption[]): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    return a === b;
  }
  return SameTypeWithAssumptions(a, b, assumptions);
}

/** #sec-sameargumentlist */
export function SameArgumentList(a: readonly (TypeRecord | number)[], b: readonly (TypeRecord | number)[], assumptions: readonly Assumption[]): boolean {
  return a.length === b.length && a.every((x, i) => sameArgument(x, b[i], assumptions));
}

/** #sec-sametypelist */
export function SameTypeList(a: readonly TypeRecord[], b: readonly TypeRecord[], assumptions: readonly Assumption[]): boolean {
  return a.length === b.length && a.every((x, i) => SameTypeWithAssumptions(x, b[i], assumptions));
}

function sameTupleElements(a: readonly TupleElementRecord[], b: readonly TupleElementRecord[], assumptions: readonly Assumption[]): boolean {
  return a.length === b.length && a.every((e, i) => e.Rest === b[i].Rest && e.Initial === b[i].Initial && SameTypeWithAssumptions(e.Type, b[i].Type, assumptions));
}

/** #sec-sametypewithassumptions */
export function SameTypeWithAssumptions(s: TypeRecord, t: TypeRecord, assumptions: readonly Assumption[]): boolean {
  if (s === t) {
    return true;
  }
  if (assumed(assumptions, s, t)) {
    return true;
  }
  // A literal refines its base and a parameterized type its [[Base]]; the
  // refinement steps of the specification fold those subtype paths in here.
  if (s.Kind === 'literal' && t.Kind !== 'literal') {
    return IsSubtype(s.Base, t, assumptions);
  }
  if (s.Kind === 'parameterized' && t.Kind !== 'parameterized') {
    return IsSubtype(s.Base, t, assumptions);
  }
  // proposal-runtime-types #sec-iteration-types: a built-in nominal may DECLARE
  // that it implements an interface. This is refinement rather than structural
  // comparison - the library types are opaque nominals whose members live in
  // side tables, so there is no structural form to compare - and it is placed
  // before the kind guard because the source is ~nominal~ and the target is
  // ~object~, which that guard would otherwise separate without looking.
  if (s.Kind === 'nominal' && t.Kind === 'object'
      && builtinImplements(s.LibraryName, s.Arguments, (declared) => IsSubtype(declared, t, [...assumptions, { First: s, Second: t }]))) {
    return true;
  }
  // proposal-runtime-types: a generic parameter is opaque within its own
  // declaration. It is a subtype of itself - which is what lets `m(v: T): T`
  // return its argument - and of its constraint, since a constrained parameter
  // is known to be at least that. Nothing else relates to it, because within
  // the declaration nothing else is known about it.
  if (s.Kind === 'parameter' || t.Kind === 'parameter') {
    if (s.Kind === 'parameter' && t.Kind === 'parameter') {
      // Name AND arity: `W<_>` and `W<_, _>` are different parameters even
      // where a declaration reuses the name, since one stands for a
      // one-argument declaration and the other for a two-argument one.
      return s.Name === t.Name && (s.Arity ?? 0) === (t.Arity ?? 0);
    }
    if (s.Kind === 'parameter' && s.Constraint) {
      return IsSubtype(s.Constraint, t, [...assumptions, { First: s, Second: t }]);
    }
    return false;
  }
  if (s.Kind !== t.Kind) {
    return false;
  }
  const next = [...assumptions, { First: s, Second: t }];
  switch (s.Kind) {
    case 'any':
    case 'void':
      return true;
    case 'primitive':
      return t.Kind === 'primitive' && s.Name === t.Name && SameArgumentList(s.Arguments, t.Arguments, next);
    case 'literal':
      return t.Kind === 'literal' && SameValue(s.Value, t.Value) && SameTypeWithAssumptions(s.Base, t.Base, next);
    case 'parameterized':
      return t.Kind === 'parameterized' && SameMetadata(s.Metadata, t.Metadata) && SameTypeWithAssumptions(s.Base, t.Base, next);
    case 'nominal':
      // A library generic type is identified by [[LibraryName]] and arguments;
      // all library types share one sentinel [[Declaration]], so compare the name
      // when either side is a library type. Otherwise identity is by declaration.
      if (s.LibraryName !== undefined || (t.Kind === 'nominal' && t.LibraryName !== undefined)) {
        return t.Kind === 'nominal' && s.LibraryName === t.LibraryName && SameArgumentList(s.Arguments, t.Arguments, next);
      }
      return t.Kind === 'nominal' && s.Declaration === t.Declaration && SameArgumentList(s.Arguments, t.Arguments, next);
    case 'union':
    case 'intersection':
      return t.Kind === s.Kind && SameTypeList(s.Members, (t as { Members: readonly TypeRecord[] }).Members, next);
    case 'tuple':
      return t.Kind === 'tuple' && sameTupleElements(s.Elements, t.Elements, next);
    case 'array':
      return t.Kind === 'array' && s.Extent === t.Extent && SameTypeWithAssumptions(s.Element, t.Element, next);
    case 'reference':
      return t.Kind === 'reference' && SameTypeWithAssumptions(s.Target, t.Target, next);
    // #sec-threading-shared-modifier: invariant in Target, as ~reference~ is,
    // and for the same reason - the storage is read AND written, so a mismatch
    // in either direction is unsound.
    case 'shared':
      return t.Kind === 'shared' && SameTypeWithAssumptions(s.Target, t.Target, next);
    case 'object': {
      const to = t as Extract<TypeRecord, { Kind: 'object' }>;
      return t.Kind === 'object' && s.Properties.length === to.Properties.length
        && s.Properties.every((p, i) => p.key === to.Properties[i].key
          && p.optional === to.Properties[i].optional
          && p.readonly === to.Properties[i].readonly
          && SameTypeWithAssumptions(p.type, to.Properties[i].type, next))
        && s.IndexSignatures.length === to.IndexSignatures.length
        && s.IndexSignatures.every((ix, i) => SameTypeWithAssumptions(ix.Key, to.IndexSignatures[i].Key, next)
          && SameTypeWithAssumptions(ix.Value, to.IndexSignatures[i].Value, next));
    }
    case 'function': {
      const tf = t as Extract<TypeRecord, { Kind: 'function' }>;
      return t.Kind === 'function' && s.Signatures.length === tf.Signatures.length
        && s.Signatures.every((g, i) => g.Parameters.length === tf.Signatures[i].Parameters.length
          && g.Parameters.every((p, j) => {
            // PLAN-rest-parameters.md phase 0: Rest and Optional are part of a
            // signature's identity, not decoration on the type.
            const q = tf.Signatures[i].Parameters[j];
            return p.Rest === q.Rest && p.Optional === q.Optional
              && SameTypeWithAssumptions(p.Type, q.Type, next);
          })
          // [[ThisType]]: both ~none~ is equal; one ~none~ is unequal; both
          // present are compared as types (spec SameSignature).
          && ((g.ThisType ?? null) === null) === ((tf.Signatures[i].ThisType ?? null) === null)
          && (!g.ThisType || SameTypeWithAssumptions(g.ThisType, tf.Signatures[i].ThisType!, next))
          && (g.Return === null) === (tf.Signatures[i].Return === null)
          && (!g.Return || SameTypeWithAssumptions(g.Return, tf.Signatures[i].Return!, next)));
    }
    default:
      return false;
  }
}

/**
 * The least length a tuple admits.
 *
 * PLAN-rest-parameters.md phase 3, per #sec-array-membership: the count of the
 * elements carrying neither a rest nor a default, WHEREVER THEY SIT. This
 * stopped at the first rest, which undercounts the moment an element follows
 * one: `[...[].<uint8>, string]` requires one element and was reported as
 * requiring none.
 */
function tupleMinLength(t: readonly TupleElementRecord[]): number {
  let n = 0;
  for (const e of t) {
    if (!e.Rest && e.Initial === 'none') {
      n += 1;
    }
  }
  return n;
}

/**
 * The range of positions the element at `k` can receive, as [least, greatest].
 *
 * A rest before an element can take nothing, so the element's earliest position
 * is the number of NON-REST elements before it; and a rest at or before it can
 * take any number, so its latest position is unbounded. Where no rest precedes
 * it, an element receives exactly its own index.
 */
function positionRange(t: readonly { readonly Rest: boolean }[], k: number): [number, number] {
  let least = 0;
  let restBefore = false;
  for (let i = 0; i < k; i += 1) {
    if (t[i].Rest) {
      restBefore = true;
    } else {
      least += 1;
    }
  }
  const unbounded = restBefore || t[k].Rest;
  return [least, unbounded ? Infinity : k];
}

/**
 * The type a SOURCE tuple can put at position `i`: the union of the types of
 * every element that could receive it, or null where none can.
 *
 * With one rest at most this is the familiar single type. With several, a
 * position may be reachable by more than one element, and requiring EACH of
 * them to be within the target's position is what keeps the relation sound -
 * the source may put any of them there.
 */
function tupleSourceTypesAt(t: readonly TupleElementRecord[], i: number): TypeRecord[] {
  const types: TypeRecord[] = [];
  for (let k = 0; k < t.length; k += 1) {
    const [least, greatest] = positionRange(t, k);
    if (i >= least && i <= greatest) {
      // A rest element's Type is the ARRAY it stands for; what it puts at ONE
      // position is that array's element (phase 5's restElementType, the same
      // unwrapping a rest parameter needs and for the same reason).
      types.push(t[k].Rest ? restElementType(t[k].Type) : t[k].Type);
    }
  }
  return types;
}

function tupleMaxLength(t: readonly TupleElementRecord[]): number {
  return t.some((e) => e.Rest) ? Infinity : t.length;
}

function tupleTypeAt(elements: readonly TupleElementRecord[], i: number): TypeRecord | null {
  let position = 0;
  for (const e of elements) {
    if (e.Rest) {
      return restElementType(e.Type);
    }
    if (position === i) {
      return e.Type;
    }
    position += 1;
  }
  return null;
}

/** #sec-issubtype */
/** Whether a Type Record is the `any` type, the element of the array family's top. */
function isAnyElement(t: TypeRecord): boolean {
  return t.Kind === 'any';
}

export function IsSubtype(s: TypeRecord, t: TypeRecord, assumptions: readonly Assumption[]): boolean {
  if (SameTypeWithAssumptions(s, t, assumptions)) {
    return true;
  }
  if (assumed(assumptions, s, t)) {
    return true;
  }
  const next = [...assumptions, { First: s, Second: t }];
  if (t.Kind === 'any') {
    return true;
  }
  if (s.Kind === 'union') {
    return s.Members.every((m) => IsSubtype(m, t, next));
  }
  if (t.Kind === 'union') {
    return t.Members.some((m) => IsSubtype(s, m, next));
  }
  // proposal-runtime-types `sec-composite-types`, the steps at #sec-issubtype:
  // "If _s_ is a composite type, then if _t_ is the top composite type, return
  // *true*; if _s_ is not the top composite type and _t_ is a composite type
  // that is not the top, return IsSubtype(sShape, the shape of t)."
  //
  // A composite type is COVARIANT IN ITS SHAPE, "which the frozenness of every
  // composite makes sound" - the usual reason width and depth subtyping is
  // unsound for objects is that a wider value can be written through a narrower
  // view, and a frozen object cannot be written at all.
  const sComposite = s.Kind === 'primitive' && s.Name === 'Composite';
  const tComposite = t.Kind === 'primitive' && t.Name === 'Composite';
  if (sComposite) {
    if (tComposite && t.Arguments.length === 0) {
      return true;
    }
    if (tComposite && s.Arguments.length > 0) {
      return IsSubtype(s.Arguments[0] as TypeRecord, t.Arguments[0] as TypeRecord, next);
    }
    // A composite also satisfies an ordinary object type through its shape,
    // which is what makes "a composite satisfies the interface" a CHECK - the
    // interface-satisfaction rule that must never cast, since a composite is
    // frozen and shared and writing member types onto it would be action at a
    // distance.
    if (t.Kind === 'object' && s.Arguments.length > 0) {
      return IsSubtype(s.Arguments[0] as TypeRecord, t, next);
    }
  }
  // #sec-enums: "An enum type is a subtype of its underlying type, so a value
  // of an enum type is usable wherever the underlying type is required and no
  // conversion is written." The relation held nowhere, because the enum's
  // record did not carry the underlying type to relate it to (F62). Placed
  // before the switch on `t` so it answers for any target the underlying type
  // is a subtype of, which is usually a primitive.
  if (s.Kind === 'nominal' && s.EnumMembers !== undefined && s.Underlying !== undefined) {
    if (IsSubtype(s.Underlying, t, next)) {
      return true;
    }
  }
  // proposal-runtime-types #sec-enums: a literal is NOT a subtype of an enum
  // type. The clause makes the reverse direction explicit - "calling the enum
  // type with a value of the underlying type returns the enumerator whose value
  // it is, and throws a TypeError when it is not one of them" - so an enum-typed
  // binding is initialized by an enumerator or by that call, and admitting a
  // bare literal here would leave the call nothing to validate.
  if (t.Kind === 'intersection') {
    return t.Members.every((m) => IsSubtype(s, m, next));
  }
  if (s.Kind === 'intersection') {
    return s.Members.some((m) => IsSubtype(m, t, next));
  }
  // proposal-runtime-types #sec-threading-shared-modifier: the modifier is not
  // observable in the VALUE. "A value of type T is assignable to storage of type
  // `shared T`, which is how a value is published, and a read of that storage
  // yields a value of T." So at a value boundary the modifier is transparent, and
  // unwraps on whichever side carries it.
  //
  // It unwraps only when the OTHER side is unmarked. Between two shared types the
  // switch below applies, which is invariance in the target, and that is what
  // keeps the distinction load-bearing where it has to be: a WRITABLE member is
  // invariant (IsObjectSubtype), so `{ x: shared uint32 }` is not viewable as
  // `{ x: uint32 }`, and the narrowing regime of a slot (#sec-shared-stability)
  // cannot be laundered by aliasing it through an object type that drops the
  // marker.
  if (s.Kind === 'shared' && t.Kind !== 'shared') {
    return IsSubtype(s.Target, t, next);
  }
  if (t.Kind === 'shared' && s.Kind !== 'shared') {
    return IsSubtype(s, t.Target, next);
  }
  // proposal-runtime-types #sec-issubtype: `[].<any>` is the top of the ARRAY
  // FAMILY - an array of some element type - so every array and every tuple is
  // one. `any` is already the type that accepts every value, and this is that
  // reading carried to the array types.
  //
  // Element invariance is untouched for every other element type: a
  // `[].<uint8>` is still not a `[].<number>`, for the reason the clause gives
  // for a generic class - the wider view would accept a Number into storage
  // typed `uint8`. What makes `any` safe where a general covariance would not
  // be is that a store to an element is checked against the ARRAY's own element
  // type at run time (#table-check-sites), so writing through the wider view is
  // refused whatever the static type said. Kotlin forbids writes through
  // `Array<*>` because it has no such check; this one does.
  //
  // Without this the bound the design writes, `T extends []`, admitted only an
  // array whose element type was literally `any` - which is to say nothing at
  // all, since no array is written that way - and the same was true of an
  // ordinary parameter typed `[].<any>`.
  if (t.Kind === 'array' && t.Extent === 'dynamic' && isAnyElement(t.Element)
      && (s.Kind === 'array' || s.Kind === 'tuple')) {
    return true;
  }
  if (s.Kind !== t.Kind) {
    return false;
  }
  switch (s.Kind) {
    case 'array': {
      const ta = t as Extract<TypeRecord, { Kind: 'array' }>;
      if (ta.Extent !== 'dynamic' && ta.Extent !== s.Extent) {
        return false;
      }
      // A fixed target with an `any` element still fixes the extent, and takes
      // any element type within it.
      if (isAnyElement(ta.Element)) {
        return true;
      }
      return SameTypeWithAssumptions(s.Element, ta.Element, next);
    }
    case 'tuple': {
      const tt = t as Extract<TypeRecord, { Kind: 'tuple' }>;
      if (tupleMinLength(s.Elements) < tupleMinLength(tt.Elements)) {
        return false;
      }
      if (tupleMaxLength(s.Elements) > tupleMaxLength(tt.Elements)) {
        return false;
      }
      // PLAN-rest-parameters.md phase 3, per #sec-issubtype. Where the TARGET
      // has more than one rest its positions are not determined by their index,
      // and the exact relation is inclusion between two regular languages - a
      // product construction, which a subtyping check cannot afford to run at
      // every use. The rule is conservative there and says so: the element
      // lists must correspond one for one, which is sound and is exact whenever
      // they do.
      if (tt.Elements.filter((e) => e.Rest).length > 1) {
        if (s.Elements.length !== tt.Elements.length) {
          return false;
        }
        return s.Elements.every((se, i) => se.Rest === tt.Elements[i].Rest
          && IsSubtype(
            se.Rest ? restElementType(se.Type) : se.Type,
            tt.Elements[i].Rest ? restElementType(tt.Elements[i].Type) : tt.Elements[i].Type,
            next,
          ));
      }
      const count = Math.max(s.Elements.length, tt.Elements.length);
      for (let i = 0; i < count; i += 1) {
        const sourceTypes = tupleSourceTypesAt(s.Elements, i);
        if (sourceTypes.length === 0) {
          continue;
        }
        const ttI = tupleTypeAt(tt.Elements, i);
        if (ttI !== null && !sourceTypes.every((st) => IsSubtype(st, ttI, next))) {
          return false;
        }
      }
      return true;
    }
    case 'reference':
      return SameTypeWithAssumptions(s.Target, (t as Extract<TypeRecord, { Kind: 'reference' }>).Target, next);
    case 'shared':
      return SameTypeWithAssumptions(s.Target, (t as Extract<TypeRecord, { Kind: 'shared' }>).Target, next);
    case 'object':
      return IsObjectSubtype(s, t as Extract<TypeRecord, { Kind: 'object' }>, next);
    case 'function':
      return IsFunctionSubtype(s, t as Extract<TypeRecord, { Kind: 'function' }>, next);
    case 'nominal': {
      // proposal-runtime-types (regexp.md and the library types generally): a raw
      // library type, written with no type arguments, is the supertype of every
      // parameterization of the same library type. This is what lets a bare
      // `RegExp` annotation hold a `RegExp.<Captures, Groups>` value inferred from
      // a literal, while `RegExp.<Captures, Groups>` itself remains invariant, so a
      // capture-shape mismatch between two written parameterizations is still an
      // error. Identity for same-argument nominals is handled by SameType above.
      const tn = t as Extract<TypeRecord, { Kind: 'nominal' }>;
      if (s.LibraryName !== undefined && tn.LibraryName === s.LibraryName
        && tn.Arguments.length === 0 && s.Arguments.length > 0) {
        return true;
      }
      // A CLASS IS A SUBTYPE OF THE CLASS IT EXTENDS. The relation held
      // nowhere, and the engine disagreed with itself about it: `new Dog() is
      // Animal` was true and `f(new Dog())` against an `Animal` parameter
      // passed, while `let a: Animal = new Dog()` was refused - the run time
      // walks a prototype chain and the checker had nothing to walk. Carried
      // the way an enum carries its underlying type (F62), for the same reason:
      // a relation the record does not hold cannot be decided.
      // An INTERFACE names a shape rather than an identity, so the declaration
      // comparison above can never admit a class that implements one: the two
      // declarations are different by construction. Compare structures instead.
      //
      // Without this a class satisfied an interface only where nothing checked
      // - `f(x: I)` passed `new C()` because a class-typed parameter resolved to
      // ~any~, and `let x: I = new C()` was refused. The two disagreed, which is
      // how the gap stayed hidden.
      // Narrowed to a CLASS source. Interface-to-interface stays nominal, or a
      // reflection context whose members are a superset of another's would
      // satisfy it - `Reflect.ClassField` passing where `Reflect.Class` is
      // wanted - and the design distinguishes those by kind, not by shape.
      if ((s.Declaration as { type?: string } | undefined)?.type === 'ClassDeclaration'
        && s.LibraryName === undefined
        && (tn.Declaration as { type?: string } | undefined)?.type === 'InterfaceDeclaration') {
        const sStructure = (s as { Structure?: TypeRecord }).Structure;
        const tStructure = (tn as { Structure?: TypeRecord }).Structure;
        if (sStructure && tStructure) {
          return IsSubtype(sStructure, tStructure, next);
        }
      }
      const base = (s as { Base?: TypeRecord }).Base;
      if (base) {
        return IsSubtype(base, t, next);
      }
      return false;
    }
    default:
      return false;
  }
}

/** Width subtyping: s has every property t requires, at a subtype. */
function IsObjectSubtype(s: Extract<TypeRecord, { Kind: 'object' }>, t: Extract<TypeRecord, { Kind: 'object' }>, assumptions: readonly Assumption[]): boolean {
  const propsOk = t.Properties.every((tp) => {
    const sp = s.Properties.find((p) => p.key === tp.key);
    if (!sp) {
      // A required property can still be met by a string index signature on s.
      if (tp.optional) {
        return true;
      }
      return s.IndexSignatures.some((ix) => ix.Key.Kind === 'primitive' && ix.Key.Name === 'string' && IsSubtype(ix.Value, tp.type, assumptions));
    }
    if (sp.optional && !tp.optional) {
      return false;
    }
    return IsSubtype(sp.type, tp.type, assumptions);
  });
  // Each of t's index signatures must be covered by one of s's.
  const indexOk = t.IndexSignatures.every((tx) => s.IndexSignatures.some((sx) => SameType(sx.Key, tx.Key) && IsSubtype(sx.Value, tx.Value, assumptions)));
  return propsOk && indexOk;
}

/**
 * Contravariant parameters, covariant return, over paired signatures.
 *
 * PLAN-rest-parameters.md phase 5, per #sec-issignaturesubtype. Two defects
 * were live here and neither needed a rest to be DECLARED to bite, since a
 * function type may carry one:
 *
 * - A rest was compared by its own type, which is the ARRAY it collects into,
 *   against an argument's type. `IsSubtype(uint32, [].<uint32>)` is false, so
 *   `(...a: [].<uint32>) => void` was assignable to nothing that took a
 *   `uint32` - the comparison is against the rest's ELEMENT type.
 * - Arity was a parameter COUNT on both sides. A source whose extra parameters
 *   are optional or a rest requires fewer arguments than it declares, and a
 *   target carrying a rest may supply more, so counting rejected pairs that
 *   relate. The clause asks whether "a requires more arguments than b may
 *   supply", which is what is asked now.
 *
 * The positional walk also ran over the SOURCE's parameters, so a target
 * position past the source's length was never checked at all. It runs over the
 * target's - the arguments that will actually arrive - and asks which source
 * parameter receives each.
 */
function IsFunctionSubtype(s: Extract<TypeRecord, { Kind: 'function' }>, t: Extract<TypeRecord, { Kind: 'function' }>, assumptions: readonly Assumption[]): boolean {
  return t.Signatures.every((tg) => s.Signatures.some((sg) => {
    if (requiredArity(sg.Parameters) > maximumSupply(tg.Parameters)) {
      return false;
    }
    // PLAN-rest-parameters.md phase 4. Where the TARGET has several rests its
    // positions are not determined by their index and the exact relation is
    // regular-language inclusion, which is the same conservative case tuples
    // have: require the lists to correspond.
    if (tg.Parameters.filter((p) => p.Rest).length > 1) {
      if (sg.Parameters.length !== tg.Parameters.length) {
        return false;
      }
      return sg.Parameters.every((sp, i) => sp.Rest === tg.Parameters[i].Rest
        && IsSubtype(parameterArgumentType(tg.Parameters[i]), parameterArgumentType(sp), assumptions))
        && (!sg.Return || !tg.Return || IsSubtype(sg.Return, tg.Return, assumptions));
    }
    // Where the SOURCE has several rests and the target supplies a finite list,
    // the exact question is whether some assignment of that list to the source's
    // parameters admits it - which is the matcher's question, asked over types
    // instead of values. Requiring every parameter that COULD receive a position
    // to accept it is sound but refuses lists the source can plainly take.
    if (sg.Parameters.filter((p) => p.Rest).length > 1 && !tg.Parameters.some((p) => p.Rest)) {
      const slots = sg.Parameters.map((p) => ({ Rest: p.Rest, Optional: p.Optional }));
      const assigned = SequenceAssignment(slots, tg.Parameters.length, (j, k) => IsSubtype(
        parameterArgumentType(tg.Parameters[j]),
        parameterArgumentType(sg.Parameters[k]),
        assumptions,
      ));
      if (assigned === 'unmatched') {
        return false;
      }
      return !sg.Return || !tg.Return || IsSubtype(sg.Return, tg.Return, assumptions);
    }
    const positionsOk = tg.Parameters.every((tp, j) => {
      // A source with several rests may receive a position at more than one
      // parameter, and EACH of them must accept what the target supplies there.
      const candidates: ParameterRecord[] = [];
      for (let k = 0; k < sg.Parameters.length; k += 1) {
        const [least, greatest] = positionRange(sg.Parameters, k);
        if (j >= least && j <= greatest) {
          candidates.push(sg.Parameters[k]);
        }
      }
      if (candidates.length === 0) {
        // The source takes fewer arguments than the target supplies, which the
        // language ignores; the clause admits it.
        return true;
      }
      return candidates.every((sp) => IsSubtype(parameterArgumentType(tp), parameterArgumentType(sp), assumptions));
    });
    if (!positionsOk) {
      return false;
    }
    if (sg.Return && tg.Return) {
      return IsSubtype(sg.Return, tg.Return, assumptions);
    }
    return true;
  }));
}

/** #sec-isassignable */
export function IsAssignable(s: TypeRecord, t: TypeRecord): boolean {
  if (s.Kind === 'any' || t.Kind === 'any') {
    return true;
  }
  return IsSubtype(s, t, []);
}
