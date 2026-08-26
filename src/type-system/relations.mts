import { SameValue, R } from '../abstract-ops/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Value, NumberValue, isTypedNumber } from '../value.mts';
import type { ParameterRecord, TypeRecord, TupleElementRecord } from './records.mts';
import { SequenceAssignment } from './sequence-assignment.mts';
import { fitsNumericType, SubstituteTypeArguments } from './runtime.mts';
import {
  maximumSupply, parameterArgumentType, requiredArity, restElementType,
} from './records.mts';
import { builtinImplements, iterationInterfaceRecord } from './iteration-types.mts';

/**
 * proposal-runtime-types #sec-structural-identity and #sec-subtyping-and-assignability
 * Pure relations over Type Records, with assumption lists so that comparison
 * of recursive types terminates.
 */
interface Assumption { readonly First: TypeRecord, readonly Second: TypeRecord }

/** A tuple iterates as the union of its positions. */
function elementUnionOfTuple(t: TypeRecord): TypeRecord | undefined {
  const elements = (t as { Elements?: readonly { Type: TypeRecord }[] }).Elements;
  if (!elements || elements.length === 0) {
    return undefined;
  }
  if (elements.length === 1) {
    return elements[0].Type;
  }
  return { Kind: 'union', Members: elements.map((e) => e.Type) } as unknown as TypeRecord;
}


/**
 * The keyed collections, which have a family top written argument by argument.
 *
 * Named rather than inlined because the same four names appear in the checker's
 * member dispatch and in the runtime's stamping, and a fifth collection added to
 * one list and not the others is the way this drifts.
 */
export const COLLECTION_LIBRARY_NAMES: ReadonlySet<string> = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

/**
 * Is this pair already assumed to hold?
 *
 * PLAN-nominal-records.md v2 task B. Identity alone is not enough for two
 * NOMINAL types. The assumption list exists so that a comparison of recursive
 * types terminates - "assume this pair holds and see whether that is
 * consistent" - and for a nominal pair the thing that recurs is the
 * DECLARATION, not the record: comparing two interfaces walks their structural
 * forms, whose member types reach the interfaces again through records built
 * along the way, and those are not the same objects. An identity compare
 * therefore never matched and the walk never ended, which is why the
 * interface-to-interface step could not be routed at all.
 *
 * Two records of one declaration with the SAME arguments are the same question.
 * The arguments matter: `Box.<uint8>` and `Box.<string>` share a declaration
 * and are not one question, and assuming they were would answer *true* for a
 * pair nothing has checked.
 */
function assumed(assumptions: readonly Assumption[], s: TypeRecord, t: TypeRecord): boolean {
  return assumptions.some((p) => {
    if (p.First === s && p.Second === t) {
      return true;
    }
    if (p.First.Kind !== 'nominal' || p.Second.Kind !== 'nominal'
      || s.Kind !== 'nominal' || t.Kind !== 'nominal') {
      return false;
    }
    return p.First.Declaration === s.Declaration
      && p.Second.Declaration === t.Declaration
      && sameArguments(p.First.Arguments, s.Arguments)
      && sameArguments(p.Second.Arguments, t.Arguments);
  });
}

/** Argument lists that name the same instantiation, compared shallowly. */
function sameArguments(a: readonly (TypeRecord | number)[], b: readonly (TypeRecord | number)[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
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
    // PLAN-brand.md F153. `source` and `flags` reach here in one of two
    // representations - plain JS strings as `metadataValueFromType` builds
    // them, engine `JSStringValue`s when the record was rebuilt from a
    // reflected node - and a raw `===` never equates the two.
    const leaf = (x: unknown) => (typeof x === 'string' ? x
      : (x as { stringValue?(): string })?.stringValue?.());
    // `__pattern` is the marker's own discriminant and is subject to the same
    // two representations as its fields: a plain `true` as built, a
    // `BooleanValue` when rebuilt. Comparing it with `===` was the last leaf
    // keeping a pattern from round-tripping after the CONTAINER was fixed
    // (F154) - three layers of the same mismatch, each hidden by the one above.
    const truthy = (x: unknown) => (x === true || (x as { booleanValue?(): boolean })?.booleanValue?.() === true);
    return truthy(ap.__pattern) === truthy(bp.__pattern)
      && leaf(ap.source) === leaf(bp.source) && leaf(ap.flags) === leaf(bp.flags);
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
    // An engine Value is compared as a VALUE, before the nested-record branch
    // below can swallow it. PLAN-brand.md F147: a SymbolValue is a JS object
    // with neither `numberValue` nor `stringValue`, so it fell into that branch
    // and was compared by `Object.keys` on the engine's own fields - identical
    // for any two symbols. Two distinct `Symbol('x')` tags therefore interned
    // to ONE type, and typeprogramming.md offers a symbol tag as precisely the
    // way to get a brand nobody else can forge.
    if (av instanceof Value && bv instanceof Value) {
      return SameValue(av, bv);
    }
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

/**
 * Whether two types are the SAME type: mutual subtyping.
 *
 * sec-type-relations defined this by an algorithm carrying three steps keyed on
 * _s_ alone - for an enum, a literal, and a parameterized type - with no mirror
 * for _t_, which made the relation ASYMMETRIC: `SameType("a", string)` answered
 * *true* where `SameType(string, "a")` answered *false*. A relation named for
 * equality that is not symmetric breaks every caller treating it as one, which
 * is how a union of a literal and its base came to discard the base.
 *
 * Mutual subtyping is symmetric BY CONSTRUCTION rather than by an algorithm that
 * must be kept symmetric, and inherits reflexivity and transitivity from
 * IsSubtype - both swept and confirmed - so it is a genuine equivalence. Scala
 * arrived at the same definition, `=:=` being mutual `<:<`.
 *
 * The refinement behaviour is not lost: it lives in IsSubtype, which is where a
 * caller asking "does this refine to that" should go. `SameTypeWithAssumptions`
 * remains the STRUCTURAL comparison IsSubtype uses internally, so this does not
 * recur through it.
 */
export function SameType(s: TypeRecord, t: TypeRecord): boolean {
  return IsSubtype(s, t, []) && IsSubtype(t, s, []);
}

/**
 * STRUCTURAL identity, for callers that need to know whether two records
 * describe the same type CONSTRUCTION rather than whether they denote the same
 * set of values.
 *
 * Interning is the case: two records that are mutually assignable may still
 * carry different metadata claims, and collapsing them loses the claim. This is
 * the relation the exported `SameType` used to be, kept under a name that says
 * what it does.
 */
export function SameTypeStructural(s: TypeRecord, t: TypeRecord): boolean {
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
    // proposal-runtime-types #sec-literal-propagation: a numeric literal takes
    // the type of the position it is written in, and for a complex position
    // that is "the literal as its real component and zero as its imaginary
    // one". Falling back to the literal's base alone made `let r: complex = 5`
    // a `number` against a `complex` and refused it, where the rule is that the
    // literal becomes one.
    //
    // The literal must be representable as the COMPONENT type, which is the
    // same requirement the conversion then applies, so a literal no `float32`
    // holds is no `complex64` either.
    if (t.Kind === 'primitive' && t.Name === 'complex' && isNumericLiteralRecord(s)) {
      const component = t.Arguments?.[0] as TypeRecord | undefined;
      if (component === undefined) {
        // Bare `complex` has `number` components, and every numeric literal is
        // a `number`, so there is nothing further to check.
        return true;
      }
      // REPRESENTABILITY, not subtyping. A literal is not a subtype of
      // `float32` - `5 is float32` is *false*, the literal's own type being
      // `number` - and yet `let f: float32 = 5` is well formed, because a
      // literal takes the type of its position when that type can hold it.
      // Asking IsSubtype here refused every literal for a `complex64`, where
      // the question is the one LiteralValueInType asks: does the component
      // type have this value.
      if (component.Kind !== 'primitive') {
        return false;
      }
      if (component.Name === 'number') {
        // Every numeric literal is a `number`, which is what bare `complex`
        // has; `fitsNumericType` describes the SIZED types and does not name it.
        return true;
      }
      const literalValue = s.Value;
      let mv;
      if (literalValue instanceof NumberValue) {
        mv = R(literalValue);
      } else if (isTypedNumber(literalValue as Value)) {
        // A typed number carries its own value; R is defined over the language
        // types and does not take one.
        mv = (literalValue as { numberValue(): number }).numberValue(); // eslint-disable-line @engine262/mathematical-value -- R does not accept a TypedNumberValue
      } else {
        return false;
      }
      return fitsNumericType(mv, component.Name, component.Arguments ?? []);
    }
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
  // An ARRAY implements `Iterable.<T>` over its element type, and did not,
  // because BUILTIN_IMPLEMENTS is keyed on a [[LibraryName]] and an array type
  // has none - it is ~array~, not ~nominal~, so the branch above could not see
  // it whatever the table said.
  //
  // The omission was invisible from the collections, which ARE in that table, and
  // it left the most obvious iterable in the language unable to reach an
  // `Iterable` parameter: `function f(i: Iterable.<uint8>)` refused a
  // `[].<uint8>` while `_a_ is Iterable.<uint8>` answered *true* for the same
  // value. A tuple reaches this too, every tuple being an array.
  if ((s.Kind === 'array' || s.Kind === 'tuple') && t.Kind === 'object') {
    const element = s.Kind === 'array'
      ? (s as { Element?: TypeRecord }).Element
      : elementUnionOfTuple(s as TypeRecord);
    if (element) {
      const iterable = iterationInterfaceRecord('Iterable', [element]);
      if (iterable && IsSubtype(iterable, t, [...assumptions, { First: s, Second: t }])) {
        return true;
      }
    }
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
    case 'application':
      // #sec-issubtype: "If _s_.[[Kind]] is ~application~ � if _s_.[[Builder]]
      // and _t_.[[Builder]] are not the same function, return *false*; return
      // SameArgumentList(�)". And #sec-computed-types: "A deferred ~application~
      // is a subtype only of itself and of the `any` type. Before specialization
      // nothing finer than identity is known about its result, so nothing finer
      // is assumed: two mentions of one deferred call are one type by interning,
      // and two different calls are unrelated until they evaluate."
      //
      // `any` is handled by its own arm above, so identity is the whole of this.
      // `any` is handled by its own arm above, so identity is the whole of this
      // WHERE THERE ARE NO FACTS.
      //
      // #sec-checked-contracts: a contract "is ASSUMED: before specialization �
      // the checker takes each clause as a known fact about the ~application~
      // Type Record. The second is sound because of the first: any
      // specialization that would falsify an assumption is stopped at the
      // builder, before the code that relied on it runs."
      //
      // So a deferred call carrying facts may relate to MORE than itself - that
      // is the whole purpose of a contract, and the reason `omit`'s caller can
      // learn that dropping properties widens. Consulting them is the remaining
      // step; until a fact is produced, `Facts` is absent and this reduces to
      // identity, which is the conservative reading the clause gives for a call
      // with no contract.
      // A LOWER bound licensed by a fact: `where Reflect.isAssignable(X, return)`
      // says every X value is a `return` value, so `X <: thisApplication`. That
      // is the direction `typeprogramming.md` �6.2 warns is easy to reverse -
      // "checking a generic body that PRODUCES the result needs a lower bound,
      // and for `omit` the true one is `T <: return`".
      if (t.Kind === 'application' && licensesLowerBound(t, s, assumptions)) {
        return true;
      }
      return t.Kind === 'application'
        && s.Builder === t.Builder
        && SameArgumentList(
          s.Arguments as readonly (TypeRecord | number)[],
          t.Arguments as readonly (TypeRecord | number)[],
          next,
        );
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
      // Matched BY KEY, not by position. An object type is a set of members and
      // not a sequence of them - `{ x: uint8, y: string }` and
      // `{ y: string, x: uint8 }` are one type - and comparing
      // `s.Properties[i]` against `to.Properties[i]` made two records with the
      // same members in a different order unequal.
      //
      // Written source never showed it: the members reach the record in the
      // order they were written, so two spellings of one type were compared
      // position by position and agreed. It surfaces where a record is BUILT
      // rather than parsed, and where two builders happen to emit their members
      // in different orders - which is what `Reflect.isAssignable(type
      // [].<uint8>, type Iterable.<uint8>)` does. The iteration interfaces are
      // reached from two directions, one through the interned type expression
      // and one through `iterationInterfaceRecord` called from the subtype
      // rules, and their nested `IteratorResult` members came out in opposite
      // orders. Every source-level test of ordering passed, which is why this
      // took so long to see: the parser normalises, so only a programmatically
      // reversed record exposes it.
      return t.Kind === 'object' && s.Properties.length === to.Properties.length
        && s.Properties.every((p) => {
          const q = to.Properties.find((other) => other.key === p.key);
          return q !== undefined
            && p.optional === q.optional
            && p.readonly === q.readonly
            && SameTypeWithAssumptions(p.type, q.type, next);
        })
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
          // [[Narrows]] likewise: #sec-declared-narrowing makes a signature's
          // narrowings part of what it establishes, so two signatures that
          // establish different things are different types. Interning compares
          // types with THIS operation rather than by the order key, so a field
          // omitted here makes the two collapse into one interned record - which
          // is what happened before: a constructed guard and a plain predicate
          // of the same shape were the same object.
          && (g.Narrows?.length ?? 0) === (tf.Signatures[i].Narrows?.length ?? 0)
          && (g.Narrows ?? []).every((nw, j) => {
            const other = tf.Signatures[i].Narrows![j]!;
            return nw.Target === other.Target && SameTypeWithAssumptions(nw.Type, other.Type, next);
          })
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

/**
 * #sec-span-type: `Span.<T>` is a library nominal, as `SoA.<T, N>` is, so it is
 * recognised by its LibraryName rather than by a Kind of its own. Keeping it a
 * nominal is deliberate: the window differs from the array types on ownership
 * and not on extent, and a Kind beside `array` would have suggested otherwise.
 */
function isSpanRecord(t: TypeRecord): boolean {
  return t.Kind === 'nominal' && (t as { LibraryName?: string }).LibraryName === 'Span';
}

/**
 * #sec-span-type: the STATED LENGTH of a `Span.<T, N>`, or ~undefined~ where
 * the window's length is not stated.
 *
 * Optional rather than always present because the two cases differ: a view over
 * a resizable buffer cannot carry its length in its type, which is why the view
 * constructor takes a count as an ARGUMENT, while a window over a known run of
 * elements can - and something has to carry it for a bounds check to be elided.
 */
function spanExtentOf(t: TypeRecord): number | undefined {
  const args = (t as { Arguments?: readonly (TypeRecord | number)[] }).Arguments;
  const second = args && args.length > 1 ? args[1] : undefined;
  return typeof second === 'number' ? second : undefined;
}

/** The element type of a `Span.<T>`, or ~undefined~ for a bare `Span`. */
function spanElementOf(t: TypeRecord): TypeRecord | undefined {
  const args = (t as { Arguments?: readonly TypeRecord[] }).Arguments;
  // A bare `Span`, or one whose argument did not resolve, has no element. It is
  // returned as ~undefined~ rather than defaulted, so a caller decides: the
  // subtype rules below refuse rather than guess, since guessing `any` would
  // make an unresolved argument silently permissive.
  const first = args && args.length > 0 ? args[0] : undefined;
  return first === undefined || first === null ? undefined : first;
}

/**
 * Does this class's declaration say it implements that interface's?
 *
 * PLAN-nominal-records.md phase 4. #sec-issubtype relates a class to an
 * interface only where the class REFINES it - "a nominal type whose declaration
 * extends or implements that type's declaration" - and the arm below compared
 * STRUCTURES for any class against any interface, so a class that declared
 * nothing satisfied an interface it happened to match. That is the one place
 * this proposal is not structural: "a class states a construction and an
 * identity as well as a shape, and it is the identity that its type is for".
 *
 * Walked up [[Base]] as well, because a class implements what its superclass
 * implements.
 */
export function ClassImplements(s: TypeRecord, interfaceDeclaration: ParseNode): boolean {
  let current: TypeRecord | undefined = s;
  const seen = new Set<TypeRecord>();
  while (current && current.Kind === 'nominal' && !seen.has(current)) {
    seen.add(current);
    const tail = (current.Declaration as { ClassTail?: { ImplementsClause?: readonly ParseNode[] | null } | null } | undefined)?.ClassTail;
    for (const ref of tail?.ImplementsClause ?? []) {
      const named = (ref as { TypeName?: { IdentifierReference?: { name?: string } } }).TypeName?.IdentifierReference?.name;
      const declaredName = (interfaceDeclaration as { BindingIdentifier?: { name?: string } } | undefined)?.BindingIdentifier?.name;
      if (typeof named === 'string' && named === declaredName) {
        return true;
      }
    }
    current = current.Base;
  }
  return false;
}

/**
 * The members a CLASS has, for comparison against an ~object~ type.
 *
 * PLAN-interface-satisfaction.md phase 1. Not `InterfaceStructureOf`: that is
 * named for what #sec-object-types defines - "The structural form of an
 * interface type ... Every interface has one. A class has none" - and widening
 * it would let the interface-to-interface step start matching classes. A class
 * has no structural FORM and it does have a SHAPE, and this is the one place
 * the difference matters: an object type asks what a value HAS.
 *
 * The shape is the class's [[Structure]], which is its own members merged under
 * the inherited ones and excludes private fields deliberately - a private
 * member is not reachable through a member expression, so no object type can
 * name it.
 */
function ClassShapeOf(t: TypeRecord): TypeRecord | undefined {
  if (t.Kind !== 'nominal' || t.LibraryName !== undefined) {
    return undefined;
  }
  const declared = (t.Declaration as { type?: string } | undefined)?.type;
  if (declared !== 'ClassDeclaration' && declared !== 'ClassExpression') {
    return undefined;
  }
  return t.Structure;
}

/**
 * The structural form of an interface type, where the type has one.
 *
 * PLAN-nominal-records.md phase 3. #sec-object-types: "The structural form of
 * an interface type is the ~object~ Type Record whose [[Members]] are the
 * members the interface declares, taken together with those it inherits ...
 * Every interface has one. A class has none: a class states a construction and
 * an identity as well as a shape, and it is the identity that its type is for."
 *
 * A LIBRARY nominal is excluded for the reason the class-satisfies-interface arm
 * already gives: the reflection contexts are distinguished by kind, not by
 * shape, and one whose members are a superset of another's must not satisfy it.
 */
function InterfaceStructureOf(t: TypeRecord): TypeRecord | undefined {
  if (t.Kind !== 'nominal' || t.LibraryName !== undefined) {
    return undefined;
  }
  if ((t.Declaration as { type?: string } | undefined)?.type !== 'InterfaceDeclaration') {
    return undefined;
  }
  return t.Structure;
}

/** A literal type whose value is a Number, which a complex position may lift. */
function isNumericLiteralRecord(s: TypeRecord & { Kind: 'literal' }): boolean {
  return s.Value instanceof NumberValue || isTypedNumber(s.Value as Value);
}

/**
 * Whether a deferred application's contract licenses `s <: t`.
 *
 * #sec-checked-contracts: before specialization "the checker takes each clause
 * as a known fact about the ~application~ Type Record". A fact is a SUBTYPE
 * EDGE, and the clause says which way it points: `Reflect.isAssignable(X, return)`
 * gives `X <: thisApplication`.
 *
 * Only that shape is read. A clause asserting a KIND - `reflect(return).kind ===
 * 'object'` - carries no edge and licenses nothing here; it is verified at every
 * evaluation instead, which is the half that already runs.
 */
function licensesLowerBound(
  t: TypeRecord & { Kind: 'application' },
  s: TypeRecord,
  assumptions: readonly Assumption[],
): boolean {
  const facts = (t as { Facts?: readonly unknown[] }).Facts;
  if (!facts || facts.length === 0) {
    return false;
  }
  for (const fact of facts) {
    const lower = (fact as { LowerBound?: TypeRecord }).LowerBound;
    if (lower && SameTypeWithAssumptions(s, lower, assumptions)) {
      return true;
    }
  }
  return false;
}

export function IsSubtype(s: TypeRecord, t: TypeRecord, assumptions: readonly Assumption[]): boolean {
  // A record that is ABSENT relates to nothing. The recursions in
  // SameTypeWithAssumptions follow `s.Base` for a literal and `s.Constraint`
  // for a type parameter, and either can be missing - an unconstrained
  // parameter has no constraint to compare - so this is reached with nothing on
  // the left. Answering "not a subtype" is the meaning of that: there is no
  // type here to be one. It was a dereference instead, which turned a question
  // with an answer into a crash, and only surfaced when generic inference began
  // binding a parameter to a type whose own record has neither field.
  if (s === null || s === undefined || t === null || t === undefined) {
    return false;
  }
  if (SameTypeWithAssumptions(s, t, assumptions)) {
    return true;
  }
  if (assumed(assumptions, s, t)) {
    return true;
  }
  const next = [...assumptions, { First: s, Second: t }];
  // PLAN-where-on-methods.md, the ASSUMED half. A checked contract's fact is a
  // LOWER bound on a deferred application - `T <: return` - so it is consulted
  // where the application is the TARGET. #sec-checked-contracts: "the checker
  // takes each clause as a known fact about the ~application~ Type Record", and
  // `typeprogramming.md` �6.2: "checking a generic body that PRODUCES the result
  // needs a lower bound, and for `omit` the true one is `T <: return`".
  //
  // Here rather than in the `case 'application':` arm of SameTypeWithAssumptions:
  // that arm fires when the application is the SOURCE, and it is reached only
  // after a kind-equality guard that a `~parameter~` source never passes.
  if (t.Kind === 'application' && licensesLowerBound(t, s, assumptions)) {
    return true;
  }
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
      && (s.Kind === 'array' || s.Kind === 'tuple' || isSpanRecord(s))) {
    return true;
  }
  // The COLLECTION family top, by the same reasoning one step along:
  // `Set.<any>` is a set of some element type and `Map.<any, any>` a map of
  // some key and value types, and every specialization reaches its family's
  // top.
  //
  // What makes `any` admissible here is what makes it admissible for the array,
  // and it transfers without weakening: a store into a collection is checked
  // against the RECEIVER's own declared types at run time - `Set.prototype.add`
  // and `Map.prototype.set` route through the [[TypedCollection]] stamp - so
  // writing through the wider view is refused whatever the static type
  // permitted. Element invariance is untouched for every other argument: a
  // `Map.<string, uint8>` is still not a `Map.<string, number>`.
  //
  // Argument by argument rather than all-or-nothing, so `Map.<string, any>`
  // is the map-of-string-keys top and not only the fully-erased form. The
  // array has one argument and so never had to say this.
  //
  // The bound this gives a caller is the one the set operations need:
  // `union<U>(other: Set.<U>)` has no spelling in a checker that cannot say
  // "a Set of some element type", and `Set.<any>` is that spelling.
  if (t.Kind === 'nominal' && s.Kind === 'nominal'
      && t.LibraryName !== undefined && t.LibraryName === s.LibraryName
      && COLLECTION_LIBRARY_NAMES.has(t.LibraryName)
      && t.Arguments.length > 0 && t.Arguments.length === s.Arguments.length
      && t.Arguments.some((a) => typeof a !== 'number' && (a as TypeRecord).Kind === 'any')) {
    return t.Arguments.every((want, i) => {
      if (typeof want !== 'number' && (want as TypeRecord).Kind === 'any') {
        return true;
      }
      const have = s.Arguments[i];
      if (typeof want === 'number' || typeof have === 'number') {
        return want === have;
      }
      return SameTypeWithAssumptions(have as TypeRecord, want as TypeRecord, next);
    });
  }
  // #sec-span-coercion: `[].<T>` and `[N].<T>` are both assignable to
  // `Span.<T>`, and a tuple is assignable to it when EVERY position's type is
  // T. The reverse never holds - a window is not assignable to either array
  // type, since neither the storage nor the right to grow it is the window's to
  // give - and that falls out of this rule being one-directional rather than
  // needing a case of its own.
  if (isSpanRecord(t)) {
    const element = spanElementOf(t);
    if (element === undefined) {
      return false;
    }
    // #sec-span-type: a source reaches `Span.<T, N>` only where its length is
    // KNOWN to be N. A `[N].<T>` and a tuple know theirs; a `[].<T>` does not,
    // its length being a run-time fact, so it reaches only the unstated form.
    const wantExtent = spanExtentOf(t);
    const elementOk = (e: TypeRecord) => isAnyElement(element) || SameTypeWithAssumptions(e, element, next);
    if (s.Kind === 'array') {
      if (wantExtent !== undefined && s.Extent !== wantExtent) {
        return false;
      }
      return elementOk(s.Element);
    }
    if (s.Kind === 'tuple') {
      if (wantExtent !== undefined && s.Elements.length !== wantExtent) {
        return false;
      }
      return s.Elements.every((e) => elementOk(e.Type));
    }
    if (isSpanRecord(s)) {
      const source = spanElementOf(s);
      if (source === undefined) {
        return false;
      }
      // Forgetting a length is always safe; inventing one is not. So
      // `Span.<T, N>` reaches `Span.<T>`, and the reverse is refused.
      if (wantExtent !== undefined && spanExtentOf(s) !== wantExtent) {
        return false;
      }
      return elementOk(source);
    }
    return false;
  }
  // PLAN-nominal-records.md phase 3, and #sec-issubtype's two structural steps.
  // They come BEFORE the step that separates the kinds, which is the whole
  // point: #sec-object-types names the failure this prevents - "Without it the
  // rules would refuse `f({ a: 'a' })` for `interface IExample { a: string; }`,
  // since an interface is a ~nominal~ type and an object literal's type is
  // ~object~, and the step separating the kinds would answer before any member
  // was inspected." That was the engine's behaviour.
  //
  // Each step continues with `next`, the assumption list carrying this pair:
  // an interface whose member type mentions the interface itself makes the
  // structural comparison recursive, and the assumption list is what ends it.
  // Passing `assumptions` unchanged blew the stack on two interfaces.
  //
  // A CLASS source is deliberately not routed here. It has no structural form,
  // so a class that declares no `implements` must not satisfy an interface by
  // shape; the class-satisfies-interface arm below handles the declared case.
  {
    // PLAN-generic-interface-membership.md. A generic interface's [[Structure]]
    // carries ~parameter~ records, so an application's arguments have to be
    // substituted here as they are at the membership site - these are the two
    // consumers the same erasure damaged, and fixing membership alone left an
    // object type comparing against unsubstituted parameters and matching
    // nothing.
    //
    // The comment above says these are "different questions of the same record";
    // they are, and they need the same substitution to ask them of the right
    // structure.
    const targetStructure = InterfaceStructureOf(t);
    if (targetStructure && s.Kind === 'object') {
      return IsSubtype(s, SubstituteTypeArguments(targetStructure, (t as { Declaration?: unknown }).Declaration, (t as { Arguments?: readonly (TypeRecord | number)[] }).Arguments), next);
    }
    const sourceStructure = InterfaceStructureOf(s);
    if (sourceStructure && t.Kind === 'object') {
      return IsSubtype(SubstituteTypeArguments(sourceStructure, (s as { Declaration?: unknown }).Declaration, (s as { Arguments?: readonly (TypeRecord | number)[] }).Arguments), t, next);
    }
    // PLAN-interface-satisfaction.md phase 1, and D-3's decided rule: AN OBJECT
    // TYPE ASKS WHAT A VALUE HAS. A class instance has its members, so it
    // reaches an object-typed position; what it does not reach without saying
    // so is an INTERFACE, which asks what a class promised (phase 2).
    //
    // Without this a class could reach no structural position at all -
    // `function f(p: { x: uint8 })` refused `new Point()` while the same value
    // passed through `any` at run time, and `is` agreed with the run time. The
    // checker and the run time disagreed, which is the shape of gap D26 exists
    // to close.
    const sourceClassShape = ClassShapeOf(s);
    if (sourceClassShape && t.Kind === 'object') {
      return IsSubtype(sourceClassShape, t, next);
    }
    // Interface to interface, where neither refines the other: both have a
    // structural form, so the question is width subtyping between them.
    //
    // Interface to interface, where neither refines the other: both have a
    // structural form, so the question is width subtyping between them.
    //
    // Routed at last, and NOT by task B alone. Two things had to change. The
    // assumption list had to key a nominal pair on its [[Declaration]], which
    // task B did and which a recursive interface needs. And this guard could
    // not call `SameType(s, t)`: instrumenting the pair showed the step being
    // re-entered with an assumption list of length ZERO every time, so nothing
    // was recursing THROUGH the list at all - `SameType` on two nominals
    // re-enters IsSubtype from the top, and the two called each other forever.
    // Identical types are already answered above by
    // `SameTypeWithAssumptions(s, t, assumptions)`, so the guard was redundant
    // as well as fatal.
    //
    // Two instantiations of ONE declaration are excluded, and that is not the
    // self-comparison the removed `SameType` guard was reaching for: they are
    // the DECLARATION-SITE VARIANCE question, which the nominal arm below
    // answers from the `in`/`out` modifiers. Comparing their structures here
    // made every generic interface covariant by inference and turned
    // `B.<uint8> <: B.<uint8 | string>` *true* for a declaration that carries
    // no modifier - "the conservative default" - which the generics suite
    // caught.
    const declarationOf = (r: TypeRecord): unknown => (r as { Declaration?: unknown }).Declaration;
    if (sourceStructure && targetStructure && declarationOf(s) !== declarationOf(t)) {
      return IsSubtype(sourceStructure, targetStructure, next);
    }
  }
  if (s.Kind !== t.Kind) {
    return false;
  }
  switch (s.Kind) {
    case 'array': {
      const ta = t as Extract<TypeRecord, { Kind: 'array' }>;
      // #sec-array-and-tuple-types: the extents must AGREE. A dynamic target
      // used to skip this check, which made `[4].<T>` assignable to `[].<T>` -
      // the unsoundness `Span.<T>` exists to replace, since a `[].<T>` may be
      // grown and a fixed array may not. `function f(p: [].<uint32>) {
      // p.push(9); }` accepted a `[4].<uint32>` and threw at the push.
      //
      // A function wanting "any array of T, however long" says `Span.<T>`
      // (#sec-span-type): the type that promises reading and writing elements
      // and says nothing about growth.
      if (ta.Extent !== s.Extent) {
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
      // proposal-runtime-types #sec-generic-variance: "where a parameter is
      // covariant, one instantiation is a subtype of another along that position
      // when the argument in the first is a subtype of the argument in the
      // second; where contravariant, when the reverse holds; where neither is
      // declared, the position is invariant".
      //
      // Only two instantiations of the SAME declaration relate this way, and
      // only where some parameter carries a modifier - so a declaration that
      // declares no variance behaves exactly as it did, which is the default the
      // clause calls conservative.
      if (s.Declaration === tn.Declaration && s.Arguments.length === tn.Arguments.length
        && s.Arguments.length > 0) {
        const params = (s.Declaration as { TypeParameters?: { TypeParameterList?: readonly { Variance?: string }[] } } | undefined)
          ?.TypeParameters?.TypeParameterList;
        if (params?.some((p) => p.Variance !== undefined)) {
          return s.Arguments.every((sa, i) => {
            const ta = tn.Arguments[i] as TypeRecord;
            const variance = params[i]?.Variance;
            if (variance === 'covariant') {
              return IsSubtype(sa as TypeRecord, ta, next);
            }
            if (variance === 'contravariant') {
              return IsSubtype(ta, sa as TypeRecord, next);
            }
            return SameTypeWithAssumptions(sa as TypeRecord, ta, next);
          });
        }
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
      // PLAN-nominal-records.md v2 task A: a class EXPRESSION is a class. The
      // guard named only |ClassDeclaration|, so `const D = class X implements I
      // {}` satisfied nothing even once its record carried a [[Structure]] -
      // the same omission, one layer up from the one that left the record
      // empty. `ClassShapeOf` above already accepts both forms.
      if (((s.Declaration as { type?: string } | undefined)?.type === 'ClassDeclaration'
        || (s.Declaration as { type?: string } | undefined)?.type === 'ClassExpression')
        && s.LibraryName === undefined
        && (tn.Declaration as { type?: string } | undefined)?.type === 'InterfaceDeclaration'
        // PLAN-interface-satisfaction.md phase 2, implementing D-3: AN INTERFACE
        // ASKS WHAT A CLASS PROMISED. A class relates to an interface only where
        // it REFINES it - #sec-issubtype, "a nominal type whose declaration
        // extends or implements that type's declaration" - and #sec-object-types
        // is explicit that a class has no structural form to be compared by.
        //
        // Comparing structures for ANY class against ANY interface admitted a
        // class that declared nothing, which made `implements` decorative and an
        // empty interface universal. The ergonomic objection to requiring it -
        // that a third-party class could then reach no structural position - is
        // answered by phase 1: an object type asks what a value HAS, and a class
        // instance reaches every object-typed position without saying anything.
        && ClassImplements(s, tn.Declaration)) {
        // PLAN-nominal-records.md phase 1: [[Structure]] is declared on the
        // record, so these read fields rather than hoping for them. The casts
        // were what let a reader believe the relation and its callers agreed.
        const { Structure: sStructure } = s;
        const { Structure: tStructure } = tn;
        if (sStructure && tStructure) {
          return IsSubtype(sStructure, tStructure, next);
        }
      }
      // PLAN-nominal-records.md phase 1: [[Base]] is declared on the record
      // now, so this reads a field rather than hoping for one.
      const { Base: base } = s;
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
    // proposal-runtime-types #sec-isobjectsubtype: "A writable member is
    // invariant, because covariance there is unsound." A single IsSubtype here
    // made every member covariant, so `{ x: uint8 }` satisfied
    // `{ x: uint8 | string }` and a String could be written through the wider
    // view into a slot the program believes holds a uint8.
    //
    // The TARGET's flag decides. A readonly target permits covariance for the
    // reason the clause gives - nothing can be written through it - and a
    // writable one demands the member types be the same.
    if (!tp.readonly) {
      // A READONLY SOURCE cannot satisfy a WRITABLE target either, and that is a
      // separate rule reading the same flag: the target's view permits writes
      // the source's declaration forbids, so admitting it would let a program
      // write through a member its own type says is immutable.
      if (sp.readonly) {
        return false;
      }
      // ~any~ satisfies an invariant position from either side. The clause's
      // soundness argument is that a write through the wider view puts a value
      // in the slot that the narrower view's readers do not expect - and that
      // argument does not apply to a member whose type is ~any~, which is the
      // program saying it has opted out of the check for that member. Requiring
      // identity there would make the escape hatch unusable in any writable
      // position, which is not what "a writable member is invariant" is for.
      if (sp.type.Kind === 'any' || tp.type.Kind === 'any') {
        return true;
      }
      return SameTypeWithAssumptions(sp.type, tp.type, assumptions);
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
    // #sec-issignaturesubtype step 1: "If a.[[Untyped]] is true, return true."
    //
    // FIRST, before the arity and parameter steps, because an untyped signature
    // is a catch-all: [[Untyped]] is a syntactic property - *true* when the
    // signature "declares no parameter type and no return type", "however much
    // is inferred for it" - so there is nothing declared for those steps to
    // judge it against.
    //
    // Its absence was not cosmetic. Reaching the arity step, an untyped
    // `function f(x, y, z) {}` was REFUSED at `(x: number) => number` for
    // requiring more arguments than the position supplies, and an untyped
    // callback that names parameters the caller does not pass is the ordinary
    // shape of existing ECMAScript - the compatibility this proposal keeps by
    // making such a function a catch-all in the first place.
    //
    // AND publishing nothing. [[Untyped]] is syntactic, so it is *true* of
    // `function g() { return f(); }` - which declares neither - while `g` still
    // PARTICIPATES in inference, because a contribution of it is anchored by
    // `f`'s declared return, and so publishes one. #sec-inferred-return-types
    // says subtyping reads "the published one otherwise", and an unconditional
    // step 1 returns before that reading can happen: `g` would satisfy
    // `() => string` while publishing `uint32`.
    //
    // So the catch-all is for a signature with nothing to judge it BY, which is
    // what step 1 means and what [[Untyped]] alone does not establish.
    if ((sg as { Untyped?: boolean }).Untyped === true
        && (sg as { InferredReturn?: unknown }).InferredReturn === undefined) {
      return true;
    }
    // proposal-runtime-types #sec-this-adoption: a signature's [[ThisType]] "is
    // contravariant, as a parameter is", so the SOURCE's `this` must be the
    // wider one - a body demanding more than the position promises would be
    // handed a value it cannot use.
    //
    // "A signature with none supplies no `this` rather than accepting any", so
    // the two absent cases are not a wildcard at either end: a signature with
    // none is usable nowhere a `this` is required, and one that HAS a
    // [[ThisType]] is usable nowhere a `this` is absent. That second half is
    // what makes a method extracted from its class an error at the boundary
    // that took it rather than a TypeError inside its body, which the clause
    // names as the case this rule decides.
    //
    // Where neither side has one - every ordinary function - nothing changes.
    const sThis = sg.ThisType ?? null;
    const tThis = tg.ThisType ?? null;
    if ((sThis === null) !== (tThis === null)) {
      return false;
    }
    // `this` is contravariant "as a parameter is", so it takes the parameter
    // rule: F136's asymmetry reached here too. `this: uint8` was refused where
    // `this: any` was declared while the mirror passed, for the same reason -
    // `IsSubtype` admits `any` only as the target. Found by checking whether
    // the defect was confined to the parameter loop; it was not.
    if (sThis !== null && tThis !== null && !parameterAccepts(tThis, sThis, assumptions)) {
      return false;
    }
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
        && parameterAccepts(parameterArgumentType(tg.Parameters[i]), parameterArgumentType(sp), assumptions))
        && (!sg.Return || !tg.Return || IsSubtype(sg.Return, tg.Return, assumptions));
    }
    // Where the SOURCE has several rests and the target supplies a finite list,
    // the exact question is whether some assignment of that list to the source's
    // parameters admits it - which is the matcher's question, asked over types
    // instead of values. Requiring every parameter that COULD receive a position
    // to accept it is sound but refuses lists the source can plainly take.
    if (sg.Parameters.filter((p) => p.Rest).length > 1 && !tg.Parameters.some((p) => p.Rest)) {
      const slots = sg.Parameters.map((p) => ({ Rest: p.Rest, Optional: p.Optional }));
      const assigned = SequenceAssignment(slots, tg.Parameters.length, (j, k) => parameterAccepts(
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
      return candidates.every((sp) => parameterAccepts(parameterArgumentType(tp), parameterArgumentType(sp), assumptions));
    });
    if (!positionsOk) {
      return false;
    }
    // #sec-issignaturesubtype, the return steps. An ABSENT return here means the
    // signature declares none and publishes none, and that is a specified
    // outcome rather than a gap: "a function whose result is unknown is
    // indistinguishable from one that never participated"
    // (#sec-inferred-return-types), so it is required nothing in this position
    // exactly as an [[Untyped]] signature is.
    //
    // It is NOT the same as declaring `any`. `function f(x: uint8): any`
    // promises nothing and so does not satisfy a promise of `uint8` - the
    // comparison below refuses it, because IsSubtype(any, uint8) is false. The
    // unannotated function made no promise to break. The engine keeps the two
    // apart by leaving [[Return]] absent for the second, which is also what
    // makes them different signatures.
    //
    // What this must NOT absorb is a RESOLUTION FAILURE, and nothing in the
    // value distinguishes the two: a declared return the checker could not read
    // also arrives absent. `PLAN-checker-type-resolution.md` R1/R2 is that
    // second meaning masquerading as this one - `(x: number) => Token`
    // satisfied `(x: number) => number` for 75 type names, because `Token` was
    // unresolvable and so indistinguishable from undeclared here.
    //
    // Stage A removed the failures at their source. Guarding this step instead
    // would be guarding a symptom: the resolvers agreeing is the property that
    // matters, and stage C2 asserts it directly, over every type-node kind,
    // where a divergence is attributable.
    if (sg.Return && tg.Return) {
      return IsSubtype(sg.Return, tg.Return, assumptions);
    }
    return true;
  }));
}

/** #sec-isassignable */
/**
 * Does a parameter typed _target_ accept a function whose parameter is typed
 * _source_? Contravariant, so the target's type must reach the source's.
 *
 * PLAN-function-family-bound.md F136. This used to call `IsSubtype` directly,
 * and that is one-directional on `any`: `IsSubtype(s, t)` admits `any` as the
 * TARGET (everything is a subtype of `any`) and not as the SOURCE. `IsAssignable`
 * is bidirectional - it returns true where EITHER side is `any` - which is the
 * gradual-typing rule and the one a boundary uses.
 *
 * Using the strict relation inside a signature made `any` in a target's
 * parameter position refuse every specific source parameter:
 *
 *   (uint8) => void  ->  (uint8) => any    // true
 *   (uint8) => void  ->  (any) => any      // FALSE, though `any` accepts a uint8
 *
 * while the mirror held, because there `any` sat on the target side of the
 * IsSubtype call:
 *
 *   (any) => void    ->  (uint8) => any    // true
 *
 * So one direction of `any` was consulted and the other was not, and a function
 * could not be passed where an `any`-parameterised signature was declared. That
 * breaks gradual typing at the function boundary on its own; the visible symptom
 * was that the FUNCTION FAMILY had no writable bound, since every candidate
 * spelling for "any function" puts `any` in exactly this position.
 *
 * With this, `(...a: [].<any>) => any` is that bound, parallel to `[].<any>` for
 * arrays and `{}` for objects - no new type name and no Type Object exception,
 * because a Type Object has no call signature to match.
 */
function parameterAccepts(target: TypeRecord, source: TypeRecord, assumptions: readonly Assumption[]): boolean {
  if (target.Kind === 'any' || source.Kind === 'any') {
    return true;
  }
  return IsSubtype(target, source, assumptions);
}

export function IsAssignable(s: TypeRecord, t: TypeRecord): boolean {
  if (s.Kind === 'any' || t.Kind === 'any') {
    return true;
  }
  return IsSubtype(s, t, []);
}

/**
 * proposal-runtime-types #sec-aredisjoint: whether no value can be of both _s_
 * and _t_.
 *
 * This is the predicate NarrowTo already spells in prose ("If _s_ and _t_ have
 * no common values, return ~empty~"), lifted to an operation so that
 * CanonicalizeType and the |IntersectionType| Early Error decide it the same
 * way the narrowing rows do. Everything it answers *true* for, the clause's own
 * note already committed to: "Two distinct ~primitive~ types have no common
 * values, since each value belongs to exactly one of them, and neither does a
 * ~primitive~ type share values with an ~object~ or ~function~ type. Two
 * ~object~ types, or two ~nominal~ types that are interfaces, may have common
 * values."
 *
 * It is deliberately CONSERVATIVE: an unknown answer is *false*, never *true*.
 * ~any~, a ~parameter~, and a not-yet-evaluated ~application~ therefore overlap
 * with everything, so a generic body cannot be diagnosed for a disjointness its
 * instantiation may not have.
 *
 * The one case that is easy to get wrong, and that the brand design depends on,
 * is ~parameterized~: two parameterizations of ONE base SHARE values, which is
 * what makes `string.<{ brand: 'E' }> & string.<{ pattern: /@/ }>` the layered
 * type of #sec-brands rather than an empty one. Disjointness is decided on the
 * BASE, never on the metadata. `ConvertValue` already carries the same rule as a
 * hand-written guard ("an intersection whose members are ALL parameterizations
 * of ONE base"), and this is that rule stated once.
 */
function baseOf(t: TypeRecord): TypeRecord {
  return t.Kind === 'parameterized' ? baseOf(t.Base) : t;
}

/** The kinds whose values are objects, and so share none with a ~primitive~. */
function isObjectLike(t: TypeRecord): boolean {
  return t.Kind === 'object' || t.Kind === 'function' || t.Kind === 'array' || t.Kind === 'tuple';
}

/** Kinds whose inhabitants are not yet known, and which therefore overlap. */
function isUndecidable(t: TypeRecord): boolean {
  return t.Kind === 'any' || t.Kind === 'parameter' || t.Kind === 'application';
}

export function AreDisjoint(s: TypeRecord, t: TypeRecord): boolean {
  if (isUndecidable(s) || isUndecidable(t)) {
    return false;
  }
  // A ~shared~ marker is not observable in the value (#sec-threading-shared-modifier),
  // so it neither creates nor removes an overlap.
  if (s.Kind === 'shared') {
    return AreDisjoint(s.Target, t);
  }
  if (t.Kind === 'shared') {
    return AreDisjoint(s, t.Target);
  }
  // An intersection is disjoint from _t_ when ANY member is: a value of the
  // intersection is a value of every member.
  if (s.Kind === 'intersection') {
    return s.Members.some((m) => AreDisjoint(m, t));
  }
  if (t.Kind === 'intersection') {
    return t.Members.some((m) => AreDisjoint(s, m));
  }
  // A union is disjoint from _t_ only when EVERY arm is. The empty union is
  // `never`, and the quantification over no arms holds, which is the
  // annihilation fact stated as disjointness.
  if (s.Kind === 'union') {
    return s.Members.every((m) => AreDisjoint(m, t));
  }
  if (t.Kind === 'union') {
    return t.Members.every((m) => AreDisjoint(s, m));
  }
  // ~void~ is the return type "no binding may hold" (#sec-undefined-and-void),
  // so it shares values with nothing but itself.
  if (s.Kind === 'void' || t.Kind === 'void') {
    return s.Kind !== t.Kind;
  }
  // Decide on the BASE, so that brand layering survives and a brand over one
  // primitive is still disjoint from another primitive.
  const sb = baseOf(s);
  const tb = baseOf(t);
  // Two literal types are disjoint unless they are the same value; a literal is
  // otherwise decided by its base, which subsumption has usually already folded.
  if (sb.Kind === 'literal' && tb.Kind === 'literal') {
    return !SameType(sb, tb) || !SameType(tb, sb);
  }
  const sPrim = sb.Kind === 'literal' ? sb.Base : sb;
  const tPrim = tb.Kind === 'literal' ? tb.Base : tb;
  if (sPrim.Kind === 'primitive' && tPrim.Kind === 'primitive') {
    return !SameType(sPrim, tPrim);
  }
  if (sPrim.Kind === 'primitive' && isObjectLike(tPrim)) {
    return true;
  }
  if (tPrim.Kind === 'primitive' && isObjectLike(sPrim)) {
    return true;
  }
  // Everything else - two ~object~ types, two ~nominal~ types, a ~nominal~
  // against an ~object~ - is left OVERLAPPING. Two object types may share a
  // value, which is the case intersections exist for; whether two unrelated
  // nominal CLASSES are disjoint is a separate question this operation
  // deliberately does not answer.
  return false;
}
