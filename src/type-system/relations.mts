import { SameValue } from '../abstract-ops/all.mts';
import type { TypeRecord, TupleElementRecord } from './records.mts';

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
function SameMetadata(a: unknown, b: unknown): boolean {
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
  return ak.every((k) => {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (av === bv) {
      return true;
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
          && g.Parameters.every((p, j) => SameTypeWithAssumptions(p, tf.Signatures[i].Parameters[j], next))
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

function tupleMinLength(t: readonly TupleElementRecord[]): number {
  let n = 0;
  for (const e of t) {
    if (e.Rest) {
      break;
    }
    n += 1;
  }
  return n;
}

function tupleMaxLength(t: readonly TupleElementRecord[]): number {
  return t.some((e) => e.Rest) ? Infinity : t.length;
}

function tupleTypeAt(elements: readonly TupleElementRecord[], i: number): TypeRecord | null {
  let position = 0;
  for (const e of elements) {
    if (e.Rest) {
      return e.Type;
    }
    if (position === i) {
      return e.Type;
    }
    position += 1;
  }
  return null;
}

/** #sec-issubtype */
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
  if (t.Kind === 'intersection') {
    return t.Members.every((m) => IsSubtype(s, m, next));
  }
  if (s.Kind === 'intersection') {
    return s.Members.some((m) => IsSubtype(m, t, next));
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
      const count = Math.max(s.Elements.length, tt.Elements.length);
      for (let i = 0; i < count; i += 1) {
        const st = tupleTypeAt(s.Elements, i);
        if (st === null) {
          continue;
        }
        const ttI = tupleTypeAt(tt.Elements, i);
        if (ttI !== null && !IsSubtype(st, ttI, next)) {
          return false;
        }
      }
      return true;
    }
    case 'reference':
      return SameTypeWithAssumptions(s.Target, (t as Extract<TypeRecord, { Kind: 'reference' }>).Target, next);
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

/** Contravariant parameters, covariant return, over paired signatures. */
function IsFunctionSubtype(s: Extract<TypeRecord, { Kind: 'function' }>, t: Extract<TypeRecord, { Kind: 'function' }>, assumptions: readonly Assumption[]): boolean {
  return t.Signatures.every((tg) => s.Signatures.some((sg) => {
    if (sg.Parameters.length > tg.Parameters.length) {
      return false;
    }
    if (!sg.Parameters.every((sp, i) => IsSubtype(tg.Parameters[i], sp, assumptions))) {
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
