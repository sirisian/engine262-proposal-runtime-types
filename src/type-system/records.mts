import { JSStringValue, Value, type SymbolValue } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/**
 * proposal-runtime-types #sec-types-and-type-objects
 * A Type Record describes an ECMAScript type. Each record has a [[Kind]] and
 * the fields listed for that kind. The ~never~ type is the union of no
 * members. Kinds not yet produced by the evaluator (~nominal~, ~object~,
 * ~function~, ~application~) are declared for the later milestones.
 */
export interface PropertyTypeRecord {
  /**
   * proposal-runtime-types: a Property Type Record's [[Key]] is "a property
   * key", which is a String OR a Symbol. It was a `string` here, so a computed
   * member name that produced a symbol had nowhere to go and the whole form was
   * refused - which is what blocked symbol metadata keys, the collision escape
   * hatch primitivemetadata.md promises third-party libraries.
   */
  readonly key: string | SymbolValue;
  readonly type: TypeRecord;
  readonly optional: boolean;
  readonly readonly: boolean;
  /**
   * proposal-runtime-types (README): "A member marked `protected` is accessible
   * within its declaring class AND ITS SUBCLASSES, and nowhere else."
   *
   * Carried on the type because the rule is "an access rule CHECKED WHERE THE
   * STATIC TYPE IS KNOWN" - and deliberately NOT a runtime wall, so nothing
   * outside the checker consults it.
   */
  readonly protected?: boolean;
  /**
   * proposal-runtime-types: an optional member's DECLARED DEFAULT, `c?: T = v`.
   *
   * A default is a CONSTRUCTION feature - it is written where a value of the
   * type is being built, and never by a check of a value that exists - so it
   * has to reach the construction sites, of which a typed composite creation is
   * one. It was dropped at the interface walk, so `Composite.<K>({id: 7})` left
   * an optional member absent where the clause fills it, and the two spellings
   * of one key did not intern together.
   */
  readonly initial?: Value;
}

/**
 * One parameter of a signature (spec: #sec-signature-records, "A Parameter
 * Record has a [[Name]], a [[Type]], an [[Optional]] field, a [[Rest]] field,
 * an [[Initial]] field, and a [[Reference]] field").
 *
 * PLAN-rest-parameters.md phase 0. A signature's parameters were a bare
 * `TypeRecord[]`, so the type system - the half that interns, relates, and
 * reflects - could not say that a parameter was a rest, was optional, or had a
 * name. The information existed twice elsewhere and in neither of those places:
 * `OverloadParameter` carried Type/Optional/Rest/HasDefault for resolution, and
 * the checker carried a parallel `Shapes` array beside each signature's types.
 * Three representations of one thing is how they drifted; this is the one.
 *
 * [[Optional]] is *true* when the parameter is marked `?` OR carries a default,
 * which is what the specification says and what collapses the separate
 * HasDefault flag. [[Reference]] is deliberately not a field: the specification
 * notes that it "restates the type for convenience, and reflection reads the
 * fact from the type", and a field that must equal `Type.Kind === 'reference'`
 * is a field that can disagree with it. Read it with `IsReferenceParameter`.
 */
export interface ParameterRecord {
  readonly Name: string;
  readonly Type: TypeRecord;
  readonly Optional: boolean;
  readonly Rest: boolean;
  /** The declared default's value, where it is known at check time. */
  readonly Initial?: Value;
}

/**
 * The ELEMENT type of a rest parameter: what ONE argument reaching it must be.
 *
 * PLAN-rest-parameters.md phase 5. A rest's own [[Type]] is what it COLLECTS -
 * `...args: [].<uint32>` has the array type - so every operation that compares
 * a single argument against a rest must compare against this instead. The
 * specification says so where it defines the annotation ("an operation
 * comparing a single argument against a rest compares against its element
 * type"), and IsFunctionSubtype was comparing against the array, which is why
 * no signature carrying a rest related to one taking that element.
 *
 * An ~array~ contributes its [[Element]]; a ~tuple~ the union of its elements'
 * types, since any of its positions may be the one an argument lands in; and
 * anything else contributes itself, which keeps an untyped or malformed rest
 * behaving as it did.
 */
export function restElementType(t: TypeRecord): TypeRecord {
  if (t.Kind === 'array') {
    return t.Element;
  }
  if (t.Kind === 'tuple') {
    const members = t.Elements.map((e) => e.Type);
    if (members.length === 0) {
      return { Kind: 'union', Members: [] };
    }
    return members.length === 1 ? members[0] : { Kind: 'union', Members: members };
  }
  return t;
}

/** The type ONE argument must satisfy to be taken by this parameter. */
export function parameterArgumentType(p: ParameterRecord): TypeRecord {
  return p.Rest ? restElementType(p.Type) : p.Type;
}

/**
 * The parameter that receives the argument at index `j`, or undefined where the
 * list cannot take one there.
 *
 * Exact while at most one parameter is a rest: a rest receives its own position
 * and every later one. A list with SEVERAL rests has no such mapping and this
 * returns undefined for it rather than guessing; the callers that need one ask
 * SequenceAssignment, which computes the whole assignment at once.
 */
export function parameterReceiving(params: readonly ParameterRecord[], j: number): ParameterRecord | undefined {
  if (params.filter((p) => p.Rest).length > 1) {
    return undefined;
  }
  const restIndex = params.findIndex((p) => p.Rest);
  if (restIndex >= 0 && j >= restIndex) {
    return params[restIndex];
  }
  return params[j];
}

/** The greatest number of arguments a parameter list may be supplied. */
export function maximumSupply(params: readonly ParameterRecord[]): number {
  return params.some((p) => p.Rest) ? Infinity : params.length;
}

/** The least number of arguments a parameter list requires. */
export function requiredArity(params: readonly ParameterRecord[]): number {
  let n = 0;
  for (const p of params) {
    if (p.Optional || p.Rest) {
      break;
    }
    n += 1;
  }
  return n;
}

/**
 * The declared type of a generator from its return annotation.
 *
 * #sec-generator-types: an annotation that is already a `Generator`
 * instantiation - `AsyncGenerator` for an async generator - is the declared type
 * as written; any other type `T` is the SHORTHAND and means
 * `Generator.<T, void, void>`, so `function* f(): int32` declares a generator of
 * `int32`. Reading a bare annotation as the YIELD type rather than as the whole
 * generator type is the design's choice and the useful one: a generator's return
 * and next types are `void` in almost every generator anyone writes.
 *
 * Returns null where the annotation is the wrong form for the generator - an
 * `AsyncGenerator` on a synchronous one or the reverse - which the caller
 * reports as a type error.
 */
export function generatorDeclaredType(annotation: TypeRecord | null, isAsync: boolean): TypeRecord | null {
  const want = isAsync ? 'AsyncGenerator' : 'Generator';
  const other = isAsync ? 'Generator' : 'AsyncGenerator';
  if (annotation && annotation.Kind === 'nominal' && annotation.LibraryName === other) {
    return null;
  }
  if (annotation && annotation.Kind === 'nominal' && annotation.LibraryName === want) {
    return annotation;
  }
  const [Y, R, N] = iterationArguments(annotation ? [annotation] : []);
  return libraryTypeRecord(want, [Y, R, N]);
}

/**
 * The three arguments of an iteration or generator type, defaulted.
 *
 * #sec-iteration-types states the shorthand once for both families: a bare
 * argument is the element type and the rest are ~void~. It lives here, in one
 * function used by both, because the agreement between them is load-bearing -
 * it is what makes a `Generator.<Y, R, N>` satisfy `IterableIterator.<Y, R, N>`
 * - and two copies of a defaulting rule is how that agreement would be lost.
 */
export function iterationArguments(args: readonly (TypeRecord | number)[]): [TypeRecord, TypeRecord, TypeRecord] {
  const at = (i: number): TypeRecord => {
    const a = args[i];
    if (typeof a === 'number' || a === undefined) {
      return i === 0 ? anyType : voidType;
    }
    return a;
  };
  return [at(0), at(1), at(2)];
}

/** The Y, R, and N of a generator type, or null where the type is not one. */
export function generatorParameters(t: TypeRecord | null | undefined): { Yield: TypeRecord, Return: TypeRecord, Next: TypeRecord } | null {
  if (!t || t.Kind !== 'nominal' || (t.LibraryName !== 'Generator' && t.LibraryName !== 'AsyncGenerator')) {
    return null;
  }
  const args = t.Arguments ?? [];
  const at = (i: number): TypeRecord => {
    const a = args[i];
    return typeof a === 'number' || a === undefined ? voidType : a;
  };
  return { Yield: at(0), Return: at(1), Next: at(2) };
}

/** #sec-signature-records: [[Reference]] restates the parameter's type. */
export function IsReferenceParameter(p: ParameterRecord): boolean {
  return p.Type.Kind === 'reference';
}

/** A parameter record, for the many sites that build a plain positional one. */
export function parameter(Type: TypeRecord, extra?: Partial<Omit<ParameterRecord, 'Type'>>): ParameterRecord {
  return {
    Name: extra?.Name ?? '', Type, Optional: extra?.Optional ?? false, Rest: extra?.Rest ?? false, ...(extra?.Initial !== undefined ? { Initial: extra.Initial } : {}),
  };
}

export interface SignatureRecord {
  readonly Parameters: readonly ParameterRecord[];
  readonly Return: TypeRecord | null;
  // proposal-runtime-types: the declared `this` type, or null where none is
  // declared (the spec's [[ThisType]], a Type Record or ~none~). Part of the
  // signature's identity, compared as a type.
  readonly ThisType?: TypeRecord | null;
}

export interface IndexSignatureRecord {
  readonly Key: TypeRecord;
  readonly Value: TypeRecord;
}

export interface TupleElementRecord {
  readonly Type: TypeRecord;
  readonly Rest: boolean;
  readonly Initial: 'none';
}

export type TypeRecord =
  | { readonly Kind: 'any' }
  | { readonly Kind: 'void' }
  /**
   * proposal-runtime-types table-type-record-kinds: a generic parameter,
   * standing for the type an application will bind, within the body and
   * signatures of its declaration.
   *
   * Without this a declaration's own annotations had nothing to resolve `T` to,
   * so a field naming it failed outright and a method signature naming it
   * failed when the method was CALLED - which is why generic classes declared
   * without complaint and did not work.
   */
  | {
    readonly Kind: 'parameter', readonly Name: string, readonly Constraint?: TypeRecord,
    /**
     * proposal-runtime-types #sec-higher-kinded-parameters: the count of `_`
     * holes the parameter declared. 0 stands for a type; n > 0 stands for a
     * generic declaration of n parameters and is NOT itself a type.
     */
    readonly Arity?: number,
  }
  | { readonly Kind: 'primitive', readonly Name: string, readonly Arguments: readonly (TypeRecord | number)[] }
  | { readonly Kind: 'literal', readonly Value: Value, readonly Base: TypeRecord }
  // proposal-runtime-types (table-metadata-values): a pattern, carried as its
  // source and flags so that one pattern written in two modules is one type. A
  // RegExp object is materialized only where a hook receives the metadata.
  | { readonly Kind: 'pattern', readonly Source: string, readonly Flags: string }
  | { readonly Kind: 'parameterized', readonly Base: TypeRecord, readonly Metadata: Value }
  | {
    readonly Kind: 'nominal',
    readonly Declaration: ParseNode,
    readonly Arguments: readonly (TypeRecord | number)[],
    // proposal-runtime-types M11: evaluated enum member values, and the
    // resolved structural shape of an interface, attached at declaration
    // evaluation. SameType compares by [[Declaration]] identity only.
    readonly EnumMembers?: readonly Value[],
    // proposal-runtime-types (#sec-enums): "An enum type is a subtype of its
    // underlying type, so a value of an enum type is usable wherever the
    // underlying type is required and no conversion is written." The record
    // carried its members and NOT its underlying type, so that subtype
    // relation could not be answered and Reflect.isAssignable said *false*
    // (F62).
    readonly Underlying?: TypeRecord,
    readonly Structure?: TypeRecord,
    // proposal-runtime-types M21: the class constructor whose instances the
    // class type contains. Identity is still by [[Declaration]]; this is the
    // resolved constructor so membership needs no name lookup.
    readonly Constructor?: Value,
    // proposal-runtime-types: a library generic type (Promise, Record) has no
    // source declaration. LibraryName gives it a stable identity: orderKey uses
    // it and SameType compares it, so `Promise.<uint32>` interns to one type
    // across a program. When present, [[Declaration]] is a shared sentinel node.
    readonly LibraryName?: string,
  }
  | { readonly Kind: 'union', readonly Members: readonly TypeRecord[] }
  | { readonly Kind: 'intersection', readonly Members: readonly TypeRecord[] }
  | { readonly Kind: 'tuple', readonly Elements: readonly TupleElementRecord[] }
  | { readonly Kind: 'array', readonly Element: TypeRecord, readonly Extent: number | 'dynamic' }
  | { readonly Kind: 'reference', readonly Target: TypeRecord }
  | { readonly Kind: 'object', readonly Properties: readonly PropertyTypeRecord[], readonly IndexSignatures: readonly IndexSignatureRecord[] }
  | { readonly Kind: 'function', readonly Signatures: readonly SignatureRecord[] };

export const anyType: TypeRecord = { Kind: 'any' };
export const voidType: TypeRecord = { Kind: 'void' };
export const neverType: TypeRecord = { Kind: 'union', Members: [] };

export function makePrimitive(Name: string, Arguments: readonly (TypeRecord | number)[] = []): TypeRecord {
  return { Kind: 'primitive', Name, Arguments };
}

/**
 * proposal-runtime-types (spec sec-vector-types): `vector.<T, N>` is well-formed
 * when T is a lane type (an integer, binary floating-point, or vector type) and N
 * is a positive integer. Returns null when the record is a well-formed vector or is
 * not a vector at all, and a diagnostic string naming the problem otherwise. A
 * nested vector lane type is validated recursively.
 */
export function validateVectorType(t: TypeRecord): string | null {
  if (t.Kind !== 'primitive' || t.Name !== 'vector') {
    return null;
  }
  const laneType = t.Arguments[0];
  const laneCount = t.Arguments[1];
  if (typeof laneType === 'number' || laneType === undefined) {
    return 'the lane type of a vector must be a type';
  }
  if (!isLaneType(laneType)) {
    return `${displayType(laneType)} is not a valid vector lane type`;
  }
  if (typeof laneCount !== 'number' || !Number.isInteger(laneCount) || laneCount <= 0) {
    return 'the lane count of a vector must be a positive integer';
  }
  return validateVectorType(laneType);
}

/**
 * A lane type is an integer type, a binary floating-point type, or a vector type
 * (spec sec-vector-types).
 */
function isLaneType(t: TypeRecord): boolean {
  if (t.Kind !== 'primitive') {
    return false;
  }
  switch (t.Name) {
    case 'int':
    case 'uint':
    case 'float16':
    case 'float32':
    case 'float64':
    case 'float128':
    case 'vector':
      return true;
    default:
      return false;
  }
}

/**
 * #sec-type-names: the shorthands each denote the same Type Record as their
 * expansion. Returns null when the name is not a built-in type name.
 */
/**
 * proposal-runtime-types: the shared sentinel Parse Node that stands in as the
 * [[Declaration]] of every library generic type. Library types are told apart by
 * [[LibraryName]], never by this node, so one sentinel for all of them is enough
 * and keeps the nominal shape (which requires a [[Declaration]]) well-formed.
 */
const libraryDeclarationSentinel = { type: 'LibraryType', location: { startIndex: -1 } } as unknown as ParseNode;

/**
 * The set of library generic type names this implementation resolves in type
 * position. Each is a nominal type distinguished by name and parameterized by its
 * type arguments; none has structural content of its own here (Promise.<R, E> is
 * an identity the reflection API and the awaited operation read).
 */
const libraryTypeNames = new Set([
  'Promise',
  // proposal-runtime-types (soa.md): `SoA.<T, Length>` is a BUILT-IN EXOTIC in
  // the same way `[].<T>` is - "something no user-defined class could express,
  // specified by the language and provided by the engine". It is a library type
  // name so that `SoA.<T, N>` resolves in type position, but unlike the names
  // below it is NOT a global constructor whose prototype chain decides
  // membership: its values are its own instances and its layout is the
  // structure-of-arrays rule, so both are answered here rather than by a
  // lookup.
  'SoA',
  // proposal-runtime-types (README Global Objects): global constructors usable as
  // type names. Each is a nominal type whose values are its instances, tested by
  // the prototype chain of the global (see IsOfType). This is what lets
  // `let e: Error`, `catch (e: TypeError)`, `let m: Map`, and the rest work.
  'AggregateError', 'ArrayBuffer', 'DataView', 'Date', 'Error', 'EvalError',
  'FinalizationRegistry', 'Map', 'Proxy', 'RangeError', 'ReferenceError',
  'RegExp', 'Set', 'SharedArrayBuffer', 'Symbol', 'SyntaxError', 'TypeError',
  'URIError', 'WeakMap', 'WeakRef', 'WeakSet',
  // proposal-runtime-types (ranges.md): the Range value type is a usable type name.
  'Range',
  // proposal-runtime-types (rational.md): the rational value type is a usable type name.
  'rational',
  // proposal-runtime-types #sec-generator-types: the generic whose instances are
  // the objects a generator function returns, and the async one. The design
  // writes `Generator.<Y, R, N>` throughout and the core already parses a return
  // annotation on a generator; neither this engine nor the specification had the
  // TYPE until PLAN-do-expressions.md phase 1, so nothing said what a call of a
  // generator returns or what a yield expression evaluates to.
  'Generator', 'AsyncGenerator',
  // proposal-runtime-types #sec-iteration-types.
  // proposal-runtime-types #sec-iteration-types: the carrier the helper methods
  // return. NOT the name a user writes - `Iterator.<T>` stays the interface, so
  // a hand-written iterator still satisfies it - and it exists so a chain's
  // next step has a receiver carrying its element type, which an interface
  // record cannot do. Declared to implement the same interfaces.
  'IteratorHelper', 'AsyncIteratorHelper',
  'IteratorResult', 'Iterable', 'IterableIterator',
  'AsyncIterable', 'AsyncIterableIterator',
]);

/**
 * Build the library generic type of the given name applied to the given
 * arguments, or null when the name is not a library type. Identity is by name and
 * arguments, so two writings of `Promise.<uint32>` are one interned type.
 */
export function libraryTypeRecord(name: string, args: readonly (TypeRecord | number)[] = []): TypeRecord | null {
  if (!libraryTypeNames.has(name)) {
    return null;
  }
  // proposal-runtime-types soa.md: `class SoA<T, Length: uint32 = 0>` declares a
  // DEFAULT, and a default means two spellings of one type - `SoA.<T>` and
  // `SoA.<T, 0>` name the same thing, as `S<T>` and `S<T, 0>` do in C++ and
  // TypeScript for the same reason. The default is filled in HERE, before
  // interning, because identity is decided by the record: leaving it out gave
  // two interned Type Objects, a `===` that answered *false* for one type, and
  // - under monomorphization - room for two specializations of every generic
  // instantiated at both spellings.
  //
  // Only SoA carries a declared default among the library types; a generic with
  // a DECLARATION applies its defaults where the declaration is read.
  const filled = name === 'SoA' && args.length === 1 ? [...args, 0] : args;
  return {
    Kind: 'nominal',
    Declaration: libraryDeclarationSentinel,
    Arguments: filled,
    LibraryName: name,
  };
}

/**
 * #table-metadata-values admits "a Number" as a metadata value, and says in as
 * many words that "a NaN is equivalent to a NaN" - so the two Numbers that have
 * NAMES rather than numeric literals are metadata values like any other, and
 * `float64.<{ max: Infinity }>` should be writable. It was not: `Infinity` and
 * `NaN` resolved as type NAMES, found nothing, and failed with "Infinity is not
 * a type", which left a bounds-shaped meta type unable to state its own default
 * and the suite writing `1e400` instead - a workaround that produces the very
 * same value, as its own error messages showed by printing it back as Infinity
 * (F63). They resolve as LITERAL types, which the language already has and
 * already writes: `let x: 1` is a literal type today.
 */
export function namedNumericLiteralRecord(name: string): TypeRecord | null {
  if (name === 'Infinity') {
    return { Kind: 'literal', Value: Value(Infinity), Base: makePrimitive('number') };
  }
  if (name === 'NaN') {
    return { Kind: 'literal', Value: Value(NaN), Base: makePrimitive('number') };
  }
  return null;
}

export function builtinTypeRecord(name: string, args: readonly (TypeRecord | number)[] = []): TypeRecord | null {
  const m = /^(u?int)(8|16|32|64|128)$/.exec(name);
  if (m) {
    return makePrimitive(m[1], [Number(m[2])]);
  }
  switch (name) {
    // proposal-runtime-types `sec-composite-types`: "A Type Record is a
    // composite type when its [[Kind]] is ~primitive~ and its [[Name]] is
    // *"Composite"*", with [[Arguments]] the shape - so `Composite` resolves
    // here among the primitive names rather than as a library nominal, and
    // `Composite.<T>` is an ordinary parameterized spelling of the same family.
    // The top composite type states no shape and is the type of every
    // composite.
    case 'Composite': return makePrimitive('Composite', args);
    case 'any': return anyType;
    case 'never': return neverType;
    case 'boolean1': return makePrimitive('uint', [1]);
    // proposal-runtime-types: `object` names the object type with no required
    // properties, to which every Object is assignable (spec: the primitive names
    // resolve as primitives "except `object`", which is an ~object~ Type Record
    // with empty Properties). It is not a ~primitive~ record.
    case 'object': return { Kind: 'object', Properties: [], IndexSignatures: [] };
    case 'float16': case 'float32': case 'float64': case 'float128':
    case 'decimal32': case 'decimal64': case 'decimal128':
    case 'number': case 'string': case 'boolean': case 'bigint': case 'symbol':
      return makePrimitive(name);
    case 'int': case 'uint': case 'rational': case 'complex': case 'vector':
      return args.length > 0 ? makePrimitive(name, args) : null;
    default:
      break;
  }
  // proposal-runtime-types (simd.md, and the shorthand table in the README): the
  // named SIMD lane types. `boolean8` and its siblings are bit vectors of
  // `boolean1`; the `NxM` names are the register-width vectors, and a name exists
  // exactly where the lanes fill a register, so `float32x4` has one and a
  // three-lane float vector does not.
  const bitVector = /^boolean(8|16|32|64)$/.exec(name);
  if (bitVector) {
    return makePrimitive('vector', [makePrimitive('uint', [1]), Number(bitVector[1])]);
  }
  const shorthand = /^(boolean|int|uint|float)(\d+)x(\d+)$/.exec(name);
  if (shorthand) {
    const [, base, widthText, lanesText] = shorthand;
    const laneBits = Number(widthText);
    const lanes = Number(lanesText);
    if (laneBits * lanes !== 128 && laneBits * lanes !== 256) {
      return null;
    }
    const lane = builtinTypeRecord(`${base}${laneBits}`);
    if (lane === null) {
      return null;
    }
    return makePrimitive('vector', [lane, lanes]);
  }
  switch (name) {
    default:
      return null;
  }
}

/**
 * A stable structural key giving the total order that CanonicalizeType sorts
 * union and intersection members by. Any deterministic order serves.
 */
export function orderKey(t: TypeRecord): string {
  switch (t.Kind) {
    case 'any': return 'any';
    case 'void': return 'void';
    case 'primitive': return `primitive:${t.Name}:${t.Arguments.map((a) => (typeof a === 'number' ? String(a) : orderKey(a))).join(',')}`;
    case 'literal': return `literal:${orderKey(t.Base)}:${String((t.Value as { value?: unknown }).value ?? t.Value)}`;
    case 'parameterized': return `parameterized:${orderKey(t.Base)}`;
    case 'nominal': return `nominal:${t.LibraryName ? `lib:${t.LibraryName}` : (t.Declaration as { location?: { startIndex?: number } }).location?.startIndex ?? 0}${t.Arguments.length > 0 ? `<${t.Arguments.map((a) => (typeof a === 'number' ? String(a) : orderKey(a))).join(',')}>` : ''}`;
    case 'union': return `union:${t.Members.map(orderKey).join('|')}`;
    case 'intersection': return `intersection:${t.Members.map(orderKey).join('&')}`;
    case 'tuple': return `tuple:${t.Elements.map((e) => `${e.Rest ? '...' : ''}${orderKey(e.Type)}`).join(',')}`;
    case 'array': return `array:${orderKey(t.Element)}:${t.Extent}`;
    case 'reference': return `reference:${orderKey(t.Target)}`;
    case 'object': return `object:${t.Properties.map((p) => `${p.readonly ? 'readonly ' : ''}${p.key}${p.optional ? '?' : ''}:${orderKey(p.type)}`).join(',')};${t.IndexSignatures.map((ix) => `[${orderKey(ix.Key)}]:${orderKey(ix.Value)}`).join(',')}`;
    // PLAN-rest-parameters.md phase 0: a parameter's Rest and Optional flags are
    // part of a signature's identity, so they belong in the canonical order key.
    // Without them `(...a: [].<uint8>) => void` and `(a: [].<uint8>) => void`
    // produce the same key and intern as ONE Type Object.
    case 'function': return `function:${t.Signatures.map((g) => `${g.ThisType ? `this:${orderKey(g.ThisType)};` : ''}(${g.Parameters.map((p) => `${p.Rest ? '...' : ''}${p.Optional ? '?' : ''}${orderKey(p.Type)}`).join(',')})=>${g.Return ? orderKey(g.Return) : ''}`).join('|')}`;
    default: return 'unknown';
  }
}

/** A readable rendering of a Type Record for error messages. */
export function displayType(t: TypeRecord): string {
  switch (t.Kind) {
    case 'any': return 'any';
    case 'void': return 'void';
    case 'primitive': return t.Arguments.length > 0 ? `${t.Name}.<${t.Arguments.map((a) => (typeof a === 'number' ? String(a) : displayType(a))).join(', ')}>` : t.Name;
    case 'literal': return `a literal type of ${displayType(t.Base)}`;
    case 'union': return t.Members.length === 0 ? 'never' : t.Members.map(displayType).join(' | ');
    case 'intersection': return t.Members.map(displayType).join(' & ');
    case 'array': return `[${t.Extent === 'dynamic' ? '' : t.Extent}].<${displayType(t.Element)}>`;
    case 'tuple': return `[${t.Elements.map((e) => displayType(e.Type)).join(', ')}]`;
    // #sec-parameterized-types: printed as written, base and metadata, so the
    // checking pass's diagnostic ("$1 is not assignable to $2") names the two
    // parameterizations rather than the word "parameterized".
    case 'parameterized': return `${displayType(t.Base)}.<${displayMetadataValue(t.Metadata)}>`;
    case 'nominal': {
      // A class or interface prints by its declared NAME. It fell through to
      // the default before, so a rejected assignment between two classes read
      // "nominal is not assignable to nominal", which names neither party and
      // is useless to whoever has to fix the program (F57).
      const declared = (t.Declaration as { BindingIdentifier?: { name?: string } | null, TypeName?: { IdentifierReference?: { name?: string } } | null } | undefined);
      const name = t.LibraryName ?? declared?.BindingIdentifier?.name ?? declared?.TypeName?.IdentifierReference?.name;
      const args = t.Arguments.length > 0 ? `.<${t.Arguments.map((a) => (typeof a === 'number' ? String(a) : displayType(a))).join(', ')}>` : '';
      return name ? `${name}${args}` : `nominal${args}`;
    }
    default: return t.Kind;
  }
}

function displayMetadataValue(m: unknown): string {
  if (m === null || m === undefined) {
    return String(m);
  }
  const leaf = m as { numberValue?(): number, stringValue?(): string, booleanValue?(): boolean };
  /* eslint-disable @engine262/mathematical-value -- R asserts a NumberValue, and a metadata field may be a String or any other literal Value; this prints, it does not compute */
  if (typeof leaf.numberValue === 'function') {
    return String(leaf.numberValue());
  }
  /* eslint-enable @engine262/mathematical-value */
  if (typeof leaf.stringValue === 'function') {
    return JSON.stringify(leaf.stringValue());
  }
  if (typeof leaf.booleanValue === 'function') {
    return String(leaf.booleanValue());
  }
  if (Array.isArray(m)) {
    return `[${m.map(displayMetadataValue).join(', ')}]`;
  }
  if (typeof m === 'object') {
    return `{ ${Object.entries(m as Record<string, unknown>).map(([k, v]) => `${k}: ${displayMetadataValue(v)}`).join(', ')} }`;
  }
  return String(m);
}

/**
 * A Property Type Record's [[Key]] as a property key VALUE. The key is a String
 * or a Symbol, and every site that reaches into an object with one needs the
 * Value rather than the raw key, so the conversion lives here rather than at
 * each of them.
 */
export function propertyKeyValue(key: string | SymbolValue): JSStringValue | SymbolValue {
  return typeof key === 'string' ? Value(key) : key;
}

/** A Property Type Record's [[Key]] as display text. */
export function displayPropertyKey(key: string | SymbolValue): string {
  return typeof key === 'string' ? key : `[${key.Description instanceof JSStringValue ? key.Description.stringValue() : ''}]`;
}

/** A generic parameter standing for what an application will bind. */
export function parameterTypeRecord(Name: string, Constraint?: TypeRecord, Arity: number = 0): TypeRecord {
  const base = Arity > 0 ? { Kind: 'parameter' as const, Name, Arity } : { Kind: 'parameter' as const, Name };
  return Constraint ? { ...base, Constraint } : base;
}

/**
 * The parameter count of a generic declaration a Type Record denotes, or null
 * where it denotes no declaration.
 *
 * #sec-higher-kinded-parameters: an argument bound to a higher-kinded parameter
 * must be "a generic class, interface, or type alias whose parameter count
 * equals the parameter's [[Arity]]", and the two ways that fails are told apart
 * by whether this returns null or a number.
 */
const LIBRARY_ARITY: Record<string, number> = {
  Promise: 2, Map: 2, WeakMap: 2, Set: 1, WeakSet: 1,
  Generator: 3, AsyncGenerator: 3, Iterator: 3, AsyncIterator: 3,
  IteratorHelper: 3, AsyncIteratorHelper: 3, RegExp: 2,
};

export function declarationParameterCount(t: TypeRecord | null | undefined): number | null {
  if (!t || t.Kind !== 'nominal') {
    return null;
  }
  const decl = (t as { Declaration?: { TypeParameters?: { TypeParameterList?: readonly unknown[] } } }).Declaration;
  const list = decl?.TypeParameters?.TypeParameterList;
  if (list) {
    return list.length;
  }
  // A LIBRARY generic has no declaration node to count, so its parameter count
  // lives here. Without this, `Box.<Map>` reported that Map "is not a generic
  // declaration" - true of its record and false of Map, and the wrong one of
  // the two diagnostics the clause distinguishes.
  const libraryName = (t as { LibraryName?: string }).LibraryName;
  return libraryName !== undefined ? LIBRARY_ARITY[libraryName] ?? null : null;
}

/**
 * The first argument that does not satisfy the higher-kinded parameter it
 * binds, described, or null where every argument is acceptable.
 *
 * #sec-higher-kinded-parameters names two failures and they are different
 * mistakes: an argument that is not a generic declaration at all, and one whose
 * parameter count differs from the arity. This returns which, so the two
 * resolvers that attach arguments - the checker's and the runtime's - can raise
 * the same pair of diagnostics from one implementation rather than two.
 */
export function badKindedArgument(
  base: TypeRecord,
  args: readonly (TypeRecord | number)[],
): { kind: 'not-generic' | 'wrong-arity', argument: TypeRecord, parameter: string, wanted: number, supplied: number } | null {
  const params = (base as { Declaration?: {
    TypeParameters?: { TypeParameterList?: readonly { BindingIdentifier?: { name: string }, Arity?: number }[] },
  } }).Declaration?.TypeParameters?.TypeParameterList;
  if (!params) {
    return null;
  }
  for (let i = 0; i < params.length && i < args.length; i += 1) {
    const wanted = params[i].Arity ?? 0;
    if (wanted === 0) {
      continue;
    }
    const argument = args[i];
    if (typeof argument === 'number') {
      continue;
    }
    const supplied = declarationParameterCount(argument);
    const parameter = params[i].BindingIdentifier?.name ?? '?';
    if (supplied === null) {
      return {
        kind: 'not-generic', argument, parameter, wanted, supplied: 0,
      };
    }
    if (supplied !== wanted) {
      return {
        kind: 'wrong-arity', argument, parameter, wanted, supplied,
      };
    }
  }
  return null;
}

/** Whether a Type Record is a higher-kinded parameter (#sec-higher-kinded-parameters). */
export function isHigherKinded(t: TypeRecord | null | undefined): boolean {
  return !!t && t.Kind === 'parameter' && (t.Arity ?? 0) > 0;
}
