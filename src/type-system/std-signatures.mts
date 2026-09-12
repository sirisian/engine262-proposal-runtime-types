import { NumberValue } from '../value.mts';
import {
  type ParameterRecord, type TypeRecord, type Known,
  libraryTypeRecord, makePrimitive, voidType, parameter,
} from './records.mts';
import { CanonicalizeType } from './intern.mts';
import { isFloatTypeName, isIntegerTypeName } from './numeric-signatures.mts';
import { indexTypeRecord } from './index-type.mts';
import { joinTypes } from './logical-types.mts';
import { R } from '#self';

/**
 * The signatures of the standard library's METHODS, built for the receiver a
 * call was made on: an iterator's, a keyed collection's, a promise's.
 *
 * A method's type depends on what the receiver carries - `map` over a
 * `[].<uint8>` takes a callback of `uint8` - so it is derived from the
 * receiver's type arguments rather than written once per name, which is also
 * what keeps the checker and #table-promise-prototype-signatures, the iterator
 * tables and the collection tables from drifting apart. A method left to the
 * run time answers *null* here.
 */

/**
 * What a value contributes once AWAITED: a `Promise.<R, E>` contributes _R_,
 * and anything else contributes itself.
 *
 * `Array.fromAsync` awaits each element, so an array of promises yields an
 * array of what they resolve with. The union case matters because the design
 * writes the parameter as `Iterable.<T | Promise.<T, any>>` - a source may mix
 * bare values and promises, and both arms contribute _T_.
 */
export const awaitedElementType = (t: Known): Known => {
  if (!t) {
    return null;
  }
  if (t.Kind === 'nominal' && t.LibraryName === 'Promise') {
    const [resolved] = t.Arguments;
    return typeof resolved === 'number' || resolved === undefined ? null : resolved as Known;
  }
  if (t.Kind === 'union') {
    const members = (t as { Members?: readonly TypeRecord[] }).Members ?? [];
    const awaited = members.map((member) => awaitedElementType(member as Known));
    if (awaited.some((x) => !x)) {
      return null;
    }
    return CanonicalizeType({ Kind: 'union', Members: awaited as TypeRecord[] } as TypeRecord) as Known;
  }
  return t;
};

// #sec-overload-resolution over the numeric library's listing
// (table-numeric-library-signatures), driven statically. The listing's
// structure collapses the general algorithm: every signature takes its
// numeric parameters at ONE type and no numeric value type is assignable to
// another, so a typed argument names the only viable family, two different
// typed arguments are viable at no signature, and with no typed argument the
// contextual type (#sec-contextual-types) selects the family through the
// return filter, which is R8's specialized call. The Number signature is
// every listed function's default: resolution to it types nothing and
// records nothing, so an untyped program stays exactly as silent as before.
export const numericFamilyOf = (t: Known): (TypeRecord & { Kind: 'primitive' }) | 'bigint' | null => {
  if (!t || t.Kind !== 'primitive') {
    return null;
  }
  if (isIntegerTypeName(t.Name) || isFloatTypeName(t.Name) || t.Name === 'number') {
    return t;
  }
  return t.Name === 'bigint' ? 'bigint' : null;
};

/** The names #sec-ranges gives a range value; each carries its element first. */
export const isRangeFamilyName = (name: string | undefined): boolean => name === 'Range'
  || name === 'RangeFrom' || name === 'RangeTo' || name === 'RangeFull' || name === 'RangeBounds';

/**
 * A bound argument's ordinal - `Bound.Closed` is 0 and `Bound.Open` is 1 -
 * whether it reached the record as the ordinal itself or as a literal record
 * carrying it, or null where the argument names no bound at all.
 */
export const boundOrdinalOf = (arg: TypeRecord | number | undefined): number | null => {
  if (typeof arg === 'number') {
    return arg;
  }
  const t = arg as { Kind?: string, Value?: unknown } | undefined;
  if (t?.Kind === 'literal' && t.Value instanceof NumberValue) {
    return R(t.Value);
  }
  return null;
};

/**
 * #sec-span-type: `Span.<T>` is a library nominal, so a receiver is
 * recognised by its LibraryName. A window has the READ surface of an array
 * and none of the operations that change a length or describe an allocation,
 * because it owns no allocation and its length is fixed.
 */
export const spanElementOfReceiver = (r: TypeRecord | null): TypeRecord | null => {
  if (!r || r.Kind !== 'nominal' || (r as { LibraryName?: string }).LibraryName !== 'Span') {
    return null;
  }
  const args = (r as { Arguments?: readonly TypeRecord[] }).Arguments;
  return args && args.length > 0 ? args[0] : { Kind: 'any' as const };
};

/** The stated length of a `Span.<T, N>` receiver, or ~undefined~ if unstated. */
export const spanExtentOfReceiver = (r: TypeRecord | null): number | undefined => {
  if (!r || r.Kind !== 'nominal' || (r as { LibraryName?: string }).LibraryName !== 'Span') {
    return undefined;
  }
  const args = (r as { Arguments?: readonly (TypeRecord | number)[] }).Arguments;
  const second = args && args.length > 1 ? args[1] : undefined;
  return typeof second === 'number' ? second : undefined;
};

/**
 * The iterator helper methods, on a receiver that iterates.
 *
 * #sec-iteration-types. These live on the `Iterator` class at run time, and
 * are reached here from whatever the receiver's type is - a `Generator`, an
 * `Iterator`, or anything else the declared-implements table says iterates -
 * because the receiver's static type is the protocol rather than the class
 * (a hand-written iterator has to satisfy the annotation too).
 *
 * `map` is the method that CHANGES the element type, so its callback's return
 * is what every downstream step infers from; `toArray` is the one that leaves
 * the family. The rest keep the element and follow those two.
 */
export const iteratorMethodSignature = (name: string, element: TypeRecord): Known => {
  const boolType = makePrimitive('boolean');
  const index = indexTypeRecord();
  const anyT = { Kind: 'any' as const } as TypeRecord;
  const fn = (params: TypeRecord[], Return: TypeRecord) => ({
    Kind: 'function',
    Signatures: [{ Parameters: params.map((t, i) => parameter(t, { Name: `a${i}` })), Return, Untyped: false }],
  } as unknown as Known);
  // (value, index) => U, the shape every helper callback takes.
  const cb = (ret: TypeRecord) => fn([element, index], ret);
  // The carrier, not the interface: a chain's next step needs a receiver
  // carrying its element type, and an interface record carries members rather
  // than arguments. `IteratorHelper` is a library name users do not write, so
  // `Iterator.<T>` stays the interface a hand-written iterator satisfies.
  const iteratorOf = (t: TypeRecord) => libraryTypeRecord('IteratorHelper', [t, voidType, voidType])!;
  switch (name) {
    case 'map': return fn([cb(anyT) as TypeRecord], iteratorOf(anyT));
    case 'filter': return fn([cb(boolType) as TypeRecord], iteratorOf(element));
    case 'take':
    case 'drop': return fn([index], iteratorOf(element));
    case 'flatMap': return fn([cb(anyT) as TypeRecord], iteratorOf(anyT));
    case 'toArray': return fn([], { Kind: 'array', Element: element, Extent: 'dynamic' } as unknown as TypeRecord);
    case 'forEach': return fn([cb(voidType) as TypeRecord], voidType);
    case 'some':
    case 'every': return fn([cb(boolType) as TypeRecord], boolType);
    case 'find': return fn([cb(boolType) as TypeRecord], { Kind: 'union', Members: [element, voidType] } as unknown as TypeRecord);
    case 'reduce': return fn([fn([anyT, element, index], anyT) as TypeRecord, anyT], anyT);
    default: return null;
  }
};

/**
 * A method of a typed COLLECTION takes its key and value positions at the
 * declared types, which sec-array-defaults-and-stores states beside the
 * array's element positions and which the run time enforces. The checker
 * knowing them is what turns `s.add(300)` on a `Set.<uint8>` from a run-time
 * RangeError into the Early Error a statically determinable mistake
 * deserves - the same step the array methods took, and the reason a
 * collection's methods were the array methods' one remaining asymmetry.
 *
 * The signatures are the DESIGN's own, written out in the weak-reference
 * section of the README rather than invented here: `add(value: T): Set.<T>`,
 * `has(value: T): boolean`, `delete(value: T): boolean`, and for the keyed
 * form `get(key: K): V | undefined`, `set(key: K, value: V): Map.<K, V>`.
 * The `undefined` in `get`'s return is the design's and is load-bearing: a
 * lookup that finds nothing answers *undefined*, so `let x: uint8 = m.get(k)`
 * is a mistake the types can see.
 */
export const collectionMethodSignature = (library: string, name: string, args: readonly (TypeRecord | number)[], receiver: TypeRecord): Known => {
  const boolType = makePrimitive('boolean');
  const anyType = { Kind: 'any' as const };
  const shapes = (types: readonly TypeRecord[], optionalFrom: number): ParameterRecord[] => types.map((t, i) => parameter(t, { Optional: i >= optionalFrom }));
  const arg = (i: number): TypeRecord => {
    const a = args[i];
    return a === undefined || typeof a === 'number' ? anyType as TypeRecord : a;
  };
  const sig = (Parameters: TypeRecord[], Return: TypeRecord, optionalFrom = Parameters.length) => ({
    Kind: 'function',
    Signatures: [{ Parameters: shapes(Parameters, optionalFrom), Return, Untyped: false }],
  } as unknown as Known);
  /**
   * A pair as a TUPLE record, which is what `entries` yields and what a
   * `for`-`of` over a `Map` destructures.
   *
   * Built the same way `BUILTIN_IMPLEMENTS` builds `Map`'s `Iterable`
   * argument, and for the reason recorded there: a tuple's Elements are
   * TupleElementRecords rather than bare types, and writing them as bare types
   * produces a record nothing matches - which is how `Map` was once silently
   * not iterable while `Set` was. Two copies of one shape is how that recurs,
   * so if a third site needs it, hoist it.
   */
  const pairOf = (a: TypeRecord, b: TypeRecord) => ({
    Kind: 'tuple',
    Elements: [a, b].map((t) => ({ Type: t, Rest: false, Initial: 'none' })),
  } as unknown as TypeRecord);
  /**
   * What `keys`, `values` and `entries` return.
   *
   * `IteratorHelper` is the CARRIER, not the interface, and the choice is
   * forced rather than preferred. The design and the specification say these
   * return `Iterator.<T>`, and they should: `sec-iteration-types` rules out
   * per-collection iterator types by name, so there is no `MapIterator` to
   * name. But in this checker `Iterator.<T>` is a structural OBJECT record
   * carrying members, with no [[Arguments]] to read - so a chain starting from
   * one loses its element type at the first step, and `m.values().map(f)`
   * would be untyped. The carrier is a nominal that keeps the element, and it
   * is DECLARED to implement `Iterator.<T>`, `IterableIterator.<T>` and
   * `Iterable.<T>` through `BUILTIN_IMPLEMENTS`, so a value of it goes
   * everywhere the interface goes.
   *
   * The two statements agree rather than conflict: the specification names the
   * interface a caller may rely on, and the checker returns a record that
   * satisfies it and can also carry a chain. It is the same choice
   * `iteratorMethodSignature` already makes for the helpers themselves.
   */
  const iteratorOf = (t: TypeRecord) => libraryTypeRecord('IteratorHelper', [t, voidType, voidType])!;
  /**
   * `Set.<any>`, the top of the set family: the bound the set operations take
   * their `other` operand at. Built from the receiver's own Declaration so it
   * is the same nominal, not a look-alike.
   */
  const setOfAny = { ...(receiver as object), Arguments: [{ Kind: 'any' }] } as unknown as TypeRecord;
  /** `(value, key, collection) => void`, the shape both forEach callbacks take. */
  const forEachCallback = (first: TypeRecord, second: TypeRecord) => ({
    Kind: 'function',
    Signatures: [{
      Parameters: [first, second, receiver].map((t, i) => parameter(t, { Name: `a${i}`, Optional: i > 0 })),
      Return: voidType,
      Untyped: false,
    }],
  } as unknown as TypeRecord);
  if (library === 'Set' || library === 'WeakSet') {
    const element = arg(0);
    switch (name) {
      case 'add': return sig([element], receiver);
      case 'has':
      case 'delete': return sig([element], boolType);
      // The design's set operations. `intersection` and `difference` draw
      // ONLY from `this`, so the result keeps the receiver's element type
      // whatever the other side holds - which is why they can be written
      // here while `union` and `symmetricDifference` cannot.
      //
      // The `other` parameter is bound at `Set.<any>`, the COLLECTION FAMILY
      // TOP. The design writes `union<U>(other: Set.<U>)`, and this is the
      // spelling of "a Set of some element type" - the thing the checker
      // previously had no way to say, so the parameter was left ~any~ and
      // `a.union(1)` type-checked.
      //
      // `Set.<any>` is admissible as the top for the reason `[].<any>` is:
      // a store is checked against the receiver's own declared types at run
      // time, so writing through the wider view is refused whatever the
      // static type permitted. Invariance is untouched for every other
      // argument.
      //
      // The RESULT type of `union` and `symmetricDifference` is not decided
      // here - it depends on the ARGUMENT's type, which a signature written
      // at the member access cannot express, so it is computed at the call
      // site. That handler predates this work; only the bound is new.
      case 'intersection':
      case 'difference': return sig([setOfAny], receiver);
      case 'isSubsetOf':
      case 'isSupersetOf':
      case 'isDisjointFrom': return sig([setOfAny], boolType);
      case 'union':
      case 'symmetricDifference': return sig([setOfAny], receiver);
      default: break;
    }
    // The members a Set has and a WeakSet does not. Guarded rather than
    // written into the switch above so that a WeakSet reaches the
    // not-declared-by refusal instead of quietly acquiring an iteration
    // surface it has no way to implement - a weak collection cannot be
    // enumerated, which is the point of it.
    if (library === 'WeakSet') {
      return null;
    }
    switch (name) {
      case 'clear': return sig([], voidType);
      // On a Set `keys` IS `values` - the same function object, not merely
      // the same behaviour - so the two share a signature.
      case 'keys':
      case 'values': return sig([], iteratorOf(element));
      // A Set's `entries` yields [v, v], which is odd and is what the
      // language does; typing it as the pair it actually yields is what lets
      // a destructuring `for (const [a, b] of s)` check.
      case 'entries': return sig([], iteratorOf(pairOf(element, element)));
      case 'forEach': return sig([forEachCallback(element, element), anyType as TypeRecord], voidType, 1);
      default: return null;
    }
  }
  const key = arg(0);
  const value = arg(1);
  switch (name) {
    // The design writes the lookup as `V | undefined`, and a union is how the
    // checker says it: a `Map.<K, V>` that does not hold the key answers
    // *undefined*, so a binding of type V is not what a lookup produces.
    case 'get': return sig([key], { Kind: 'union', Members: [value, makePrimitive('undefined')] } as TypeRecord);
    case 'set': return sig([key, value], receiver);
    case 'has':
    case 'delete': return sig([key], boolType);
    // `getOrInsert` postdates the design's listing, so its return is read off
    // its own semantics rather than quoted: it answers the value it found or
    // the one it inserted, and never *undefined*.
    case 'getOrInsert': return sig([key, value], value);
    // Same shape, but the value is computed from the key rather than passed.
    //
    // The callback's PARAMETER is typed and its RETURN is left ~any~,
    // deliberately. Constraining the return to V is more precise and refuses
    // the natural spelling: `m.getOrInsertComputed("a", (k) => 1)` fails with
    // "a literal type of number is not assignable to uint.<8>", because
    // inferring a callback's return from the expected type is the
    // argument-position inference the design lists as deferred. An
    // annotated callback would work and an unannotated one would not, which
    // is a worse trade than under-approximating - and the value is checked
    // at insertion regardless, so a wrong one is refused either way, just at
    // run time. Same reasoning as the `other` parameter of the set
    // operations above; when inference from an expected type lands, tighten
    // both together.
    case 'getOrInsertComputed': return sig([key, ({
      Kind: 'function',
      Signatures: [{ Parameters: [parameter(key, { Name: 'key' })], Return: anyType as TypeRecord, Untyped: false }],
    } as unknown as TypeRecord)], value);
    default: break;
  }
  if (library === 'WeakMap') {
    return null;
  }
  // README, "Weak References": `register(target: object | symbol, heldValue:
  // T, unregisterToken?: object | symbol): void` and `unregister(token:
  // object | symbol): boolean`. The HELD value is the type argument and is
  // unconstrained; the TARGET and the token must be weakly referenceable, and
  // a literal or value-typed argument is refused here rather than at run
  // time, so `register("s", 1)` is an Early Error and not the run time's
  // TypeError.
  if (library === 'FinalizationRegistry') {
    const weaklyHeld = joinTypes(makePrimitive('object') as TypeRecord, makePrimitive('symbol') as TypeRecord) as TypeRecord;
    const held = arg(0);
    switch (name) {
      case 'register': return sig([weaklyHeld, held, weaklyHeld], voidType, 2);
      case 'unregister': return sig([weaklyHeld], boolType);
      default: return null;
    }
  }
  switch (name) {
    case 'clear': return sig([], voidType);
    case 'keys': return sig([], iteratorOf(key));
    case 'values': return sig([], iteratorOf(value));
    case 'entries': return sig([], iteratorOf(pairOf(key, value)));
    // (value, key, map) - the value FIRST, which is the order the language
    // chose and the order a reader gets wrong. Typing it is most of the value
    // of typing `forEach` at all.
    case 'forEach': return sig([forEachCallback(value, key), anyType as TypeRecord], voidType, 1);
    default: return null;
  }
};

/**
 * `then`, `catch` and `finally` on a `Promise.<R, E>`.
 *
 * #table-promise-prototype-signatures. A handler's parameter is the type the
 * receiver carries, and those positions are the only ones either type is
 * read from, so `p.then((v) => { let s: string = v; })` on a `Promise.<uint8,
 * Error>` is refused as the same shape on an array is.
 *
 * Every result rejects with `any`: a handler is a function, anything may
 * throw, and "the reject type is never inferred". So a handled rejection does
 * NOT narrow - a `never` there would claim a promise cannot reject when a
 * throwing handler makes it reject - and `finally` widens for the same reason.
 * `then` and `catch` answer alike because `p.then(f, g)` and
 * `p.then(f).catch(g)` differ only in spelling.
 */
export const promiseMethodSignature = (name: string, resolution: TypeRecord, rejection: TypeRecord): Known => {
  const anyType = { Kind: 'any' as const } as TypeRecord;
  const shapes = (types: readonly TypeRecord[], optionalFrom: number): ParameterRecord[] => types.map((t, i) => parameter(t, { Optional: i >= optionalFrom }));
  const handler = (takes: TypeRecord): TypeRecord => ({
    Kind: 'function',
    Signatures: [{ Parameters: [parameter(takes)], Return: anyType, Untyped: false }],
  } as unknown as TypeRecord);
  const promiseOf = (r: TypeRecord): TypeRecord => (libraryTypeRecord('Promise', [r, anyType]) ?? anyType) as TypeRecord;
  // The handlers' RETURN types are independent, and neither is known from the
  // receiver, so the result resolves with `any` rather than with a union this
  // arm cannot compute. Naming a narrower type here would be a claim the
  // signature cannot support - the same error `Promise.resolve`'s pinned `any`
  // rejection was, one position over.
  switch (name) {
    case 'then':
      return { Kind: 'function', Signatures: [{ Parameters: shapes([handler(resolution), handler(rejection)], 0), Return: promiseOf(anyType), Untyped: false }] } as unknown as Known;
    case 'catch':
      return { Kind: 'function', Signatures: [{ Parameters: shapes([handler(rejection)], 0), Return: promiseOf(anyType), Untyped: false }] } as unknown as Known;
    case 'finally':
      return { Kind: 'function', Signatures: [{ Parameters: shapes([{ Kind: 'function', Signatures: [{ Parameters: [], Return: anyType, Untyped: false }] } as unknown as TypeRecord], 0), Return: promiseOf(resolution), Untyped: false }] } as unknown as Known;
    default:
      return null;
  }
};
