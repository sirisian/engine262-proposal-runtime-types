// The iteration types, per proposal-runtime-types #sec-iteration-types.
//
// These are built-in INTERFACES rather than library classes: the protocols are
// satisfied structurally, because `for`-`of` asks whether [Symbol.iterator] is
// callable and never asks what a value declared. A type refusing a hand-written
// `{ next() { … } }` would describe a language this is not.
//
// `IteratorResult` comes first because it is what `next` returns and nothing
// else can be written before it.

import type { TypeRecord } from './records.mts';
import {
  anyType, makePrimitive, parameter, iterationArguments, libraryTypeRecord, iteratorCompletionValue,
} from './records.mts';
import { CanonicalizeType } from './intern.mts';
import { SameType } from './relations.mts';
import { wellKnownSymbols, Value, surroundingAgent } from '#self';

const BUILTIN_INTERFACES = new Set([
  'IteratorResult',
  // `standardlibrary.md`: `type PromiseSettledResult<R, E> = { status: string,
  // value?: R, reason?: E }`. Structural like `IteratorResult` and unlike
  // `Promise`, so it belongs to this family rather than to the library NOMINALS -
  // a program writes the shape, not a branded name.
  //
  // It is here so that `Promise.allSettled`'s signature can name it. A signature
  // naming a type the program cannot write would be worse than none, which is
  // why that row waited for this.
  'PromiseSettledResult',
  'Iterator', 'Iterable', 'IterableIterator',
  'AsyncIterator', 'AsyncIterable', 'AsyncIterableIterator',
]);

/**
 * `Identity`, the wrapper that means NO wrapper (standardlibrary.md).
 *
 * It is separate from BUILTIN_INTERFACES because it is not an interface: every
 * member of that family DESCRIBES a shape and Identity REDUCES to its argument,
 * which is what an alias does. Applied, it is its argument; unapplied, it must
 * stay a declaration, since a higher-kinded parameter binds declarations and a
 * reduced `any` would be refused as not being one.
 */
export function identityRecord(args: readonly (TypeRecord | number)[]): TypeRecord | null {
  const first = args[0];
  if (first === undefined || typeof first === 'number') {
    return null;
  }
  return first;
}

/**
 * The unapplied `Identity` declaration, as a Type Record a higher-kinded
 * parameter can bind.
 *
 * `Identity` is the first built-in type name that is passed AS an argument
 * rather than only used as a type, so its global binding cannot hold a
 * stand-in: a kinded position asks whether the argument is a generic
 * declaration of matching arity, and answers no for anything else. The record
 * carries a synthesized single-parameter alias declaration, which is what
 * `type Identity<T> = T` produces and what declarationParameterCount counts.
 */
const parsedIdentityDeclarations = new WeakMap<object, TypeRecord>();

/**
 * Record the `Identity` declaration a prelude parsed, so the global binding can
 * hold a PARSED node rather than an assembled one.
 *
 * A declaration built by hand satisfies the shape a type check reads without
 * satisfying the shape the runtime walks, and crashes at the first enforced
 * annotation. The parser produces the node every consumer expects.
 */
export function setParsedIdentityDeclaration(record: TypeRecord): void {
  const realm = currentRealmOrUndefined();
  if (realm) {
    parsedIdentityDeclarations.set(realm, record);
  }
}

/**
 * The running realm, or *undefined* where there is none.
 *
 * `currentRealmRecord` reads the top of the execution context stack and throws
 * when it is empty, which it is while a realm is being CONSTRUCTED - exactly
 * when this registry is first written. Asking safely is the difference between
 * a per-realm registry and a crash during realm setup.
 */
function currentRealmOrUndefined(): object | undefined {
  const stack = (surroundingAgent as { executionContextStack?: { length: number } }).executionContextStack;
  if (!stack || stack.length === 0) {
    return undefined;
  }
  return surroundingAgent.currentRealmRecord as object | undefined;
}

/**
 * The parsed `Identity` declaration for a realm, or null before its prelude has
 * run.
 *
 * Kept PER REALM. It was one module-level binding, so the first realm in a
 * process left its parsed node behind for every realm after it - measured,
 * `typeof Identity` was *undefined* in the first realm and "object" in the rest,
 * and the ones that worked were holding another realm's node. Two realms in one
 * agent are independent, and a declaration parsed in one is not a declaration of
 * the other.
 */
export function getParsedIdentityDeclaration(realm?: object): TypeRecord | null {
  const key = realm ?? currentRealmOrUndefined();
  return (key && parsedIdentityDeclarations.get(key)) ?? null;
}

export function identityDeclarationRecord(): TypeRecord {
  return {
    Kind: 'nominal',
    Declaration: {
      type: 'TypeAliasDeclaration',
      BindingIdentifier: { type: 'BindingIdentifier', name: 'Identity' },
      TypeParameters: {
        type: 'TypeParameters',
        TypeParameterList: [{
          type: 'TypeParameter',
          BindingIdentifier: { type: 'BindingIdentifier', name: 'T' },
          TypeParameterConstraint: null,
          TypeParameterDefault: null,
          Arity: 0,
        }],
      },
      WhereClauses: null,
    },
    Arguments: [],
    LibraryName: 'Identity',
  } as unknown as TypeRecord;
}

/** Whether a type name is one of the iteration interfaces. */
/**
 * #sec-iteration-types: "The protocols are interface types, satisfied
 * structurally through their structural form." Each is an interface
 * declaration: a class may name one in `implements`, an interface may extend
 * one, and `IterableIterator` extends `Iterable` and `Iterator` as the
 * declaration `interface IterableIterator<T, R, N> extends Iterable.<T>,
 * Iterator.<T, R, N>` does (#sec-interface-declaration-identity). The record
 * built by iterationInterfaceRecord is the structural form of that interface.
 */
const PROTOCOL_INTERFACES = new Set(['Iterable', 'Iterator', 'IterableIterator', 'AsyncIterable', 'AsyncIterator', 'AsyncIterableIterator']);
type ProtocolDeclaration = {
  readonly type: 'InterfaceDeclaration',
  readonly ProtocolName: string,
  readonly Parameters: readonly TypeRecord[],
  Structure?: TypeRecord,
  Extends?: readonly TypeRecord[],
};
const protocolDeclarations = new Map<string, ProtocolDeclaration>();
/**
 * The declaration of a protocol, in the shape a parsed generic interface
 * declaration has: type parameters `T`, or `T`, `R` and `N`, a structural form
 * stated over them, and for the two iterable-iterator protocols the
 * applications they extend. An application is then an ordinary generic
 * application, which every substitution already understands.
 */
function protocolDeclaration(name: string): ProtocolDeclaration {
  const existing = protocolDeclarations.get(name);
  if (existing) return existing;
  const names = name === 'Iterable' || name === 'AsyncIterable' ? ['T'] : ['T', 'R', 'N'];
  const parameterNodes = names.map((each) => ({ type: 'TypeParameter', BindingIdentifier: { type: 'BindingIdentifier', name: each }, ProtocolParameter: true }));
  const Parameters = parameterNodes.map((node) => ({ Kind: 'parameter', Name: node.BindingIdentifier.name, Declaration: node }) as unknown as TypeRecord);
  const declaration = {
    type: 'InterfaceDeclaration' as const,
    BindingIdentifier: { type: 'BindingIdentifier', name },
    TypeParameters: { type: 'TypeParameters', ListKind: 'parameters', TypeParameterList: parameterNodes },
    Heritage: [],
    InterfaceMemberList: [],
    Partial: false,
    ProtocolName: name,
    Parameters,
    sourceText: `interface ${name}`,
    strict: true,
  } as ProtocolDeclaration;
  protocolDeclarations.set(name, declaration);
  const [T, R, N] = [Parameters[0]!, Parameters[1] ?? Parameters[0]!, Parameters[2] ?? Parameters[0]!];
  declaration.Structure = iterationInterfaceRecord(name, names.length === 1 ? [T] : [T, R, N])!;
  const application = (base: string, args: readonly TypeRecord[]): TypeRecord => ({
    Kind: 'nominal', Declaration: protocolDeclaration(base), Arguments: args, Structure: protocolDeclaration(base).Structure,
  }) as unknown as TypeRecord;
  if (name === 'IterableIterator') declaration.Extends = [application('Iterable', [T]), application('Iterator', [T, R, N])];
  if (name === 'AsyncIterableIterator') declaration.Extends = [application('AsyncIterable', [T]), application('AsyncIterator', [T, R, N])];
  return declaration;
}
export function isProtocolInterfaceName(name: string): boolean {
  return PROTOCOL_INTERFACES.has(name);
}
/** The protocol a record's declaration is, or undefined where it is not one. */
export function protocolNameOf(record: TypeRecord | null | undefined): string | undefined {
  return record?.Kind === 'nominal' ? (record.Declaration as { ProtocolName?: string } | undefined)?.ProtocolName : undefined;
}
/**
 * The interface type a protocol name denotes at these arguments; any other
 * built-in interface name keeps its structural record. A bare name takes the
 * defaults, as `Iterator.<uint8>` is `Iterator.<uint8, void, void>`.
 */
export function protocolInterfaceRecord(name: string, args: readonly (TypeRecord | number)[] = []): TypeRecord | null {
  if (!PROTOCOL_INTERFACES.has(name)) return iterationInterfaceRecord(name, args);
  const declaration = protocolDeclaration(name);
  const [T, R, N] = iterationArguments(args);
  return {
    Kind: 'nominal',
    Declaration: declaration,
    Arguments: declaration.Parameters.length === 1 ? [T] : [T, R, N],
    Structure: declaration.Structure,
    ...(declaration.Extends ? { Extends: declaration.Extends, Bases: declaration.Extends } : {}),
  } as unknown as TypeRecord;
}

export function isIterationInterfaceName(name: string): boolean {
  return BUILTIN_INTERFACES.has(name);
}

function objectType(properties: { key: string | symbol, type: TypeRecord, optional?: boolean, readonly?: boolean }[]): TypeRecord {
  return {
    Kind: 'object',
    Properties: properties.map((p) => ({
      // A host string or a host symbol is translated; a key that is ALREADY a
      // SymbolValue is passed through. `IterableIterator` builds itself by
      // spreading the properties of `Iterator` and `Iterable`, which have been
      // through this function once, and a second pass read `.description` off a
      // SymbolValue - which has `Description` - so the lookup produced
      // *undefined* and the property had no key at all. The composed interface
      // then matched nothing, and displaying it crashed on the missing key.
      key: typeof p.key === 'string'
        ? p.key
        : (typeof p.key === 'symbol'
          ? (wellKnownSymbols as unknown as Record<string, unknown>)[p.key.description!]
          : p.key),
      type: p.type,
      optional: p.optional ?? false,
      readonly: false,
    })),
    // Required by the record shape and omitted at first, which is what made the
    // RUNTIME walk crash while the checker was happy: EnforceAnnotation reads
    // IndexSignatures without guarding, where the checker never reaches it.
    IndexSignatures: [],
  } as unknown as TypeRecord;
}

/**
 * The receiver a method signature carries. The members of the protocols are
 * METHODS, as their declarations write them - `next(value?: N)`,
 * `[Symbol.iterator]()` - so a class's method is one by the ordinary rule
 * that two methods agree on the self [[ThisType]] (#sec-this-adoption). The
 * checker registers the record its own method signatures use, since a
 * receiver is compared by identity.
 */
let protocolReceiver: TypeRecord | undefined;
export function registerProtocolReceiver(record: TypeRecord): void {
  protocolReceiver = record;
}
function methodType(params: TypeRecord[], ret: TypeRecord): TypeRecord {
  const fn = fnType(params, ret) as unknown as { Signatures: { ThisType?: TypeRecord }[] };
  if (protocolReceiver) fn.Signatures[0]!.ThisType = protocolReceiver;
  return fn as unknown as TypeRecord;
}

function fnType(params: TypeRecord[], ret: TypeRecord): TypeRecord {
  // Built through `parameter` rather than by hand: a ParameterRecord has fields
  // beyond the obvious four, and a hand-built one compares unequal to a
  // constructed one even when every visible field matches - which is what made
  // two identically-spelled `Iterable.<uint8>` records fail to be subtypes.
  return {
    Kind: 'function',
    Signatures: [{
      Parameters: params.map((t, i) => parameter(t, { Name: `arg${i}`, Optional: true })),
      Return: ret,
      Untyped: false,
    }],
  } as unknown as TypeRecord;
}

const booleanLiteral = (v: boolean): TypeRecord => ({
  // An engine Value, not a JS boolean: literal subtyping compares with
  // SameValue, and two raw booleans compare unequal to the Value the rest of
  // the type system carries - which made two identically-spelled records fail
  // to be subtypes with nothing visibly different about them.
  Kind: 'literal', Value: v ? Value.true : Value.false, Base: makePrimitive('boolean'),
} as unknown as TypeRecord);

/**
 * `IteratorResult.<T, R>` — a union of two object types discriminated by `done`.
 *
 * This is the shape a `match` reads without a narrowing rule of its own: one arm
 * binds `value` at T, the other at IteratorCompletionValue(R). A discarded
 * completion is gradual; an explicit undefined completion remains precise.
 */
function iteratorResult(T: TypeRecord, R: TypeRecord): TypeRecord {
  return {
    Kind: 'union',
    Members: [
      objectType([{ key: 'value', type: T }, { key: 'done', type: booleanLiteral(false) }]),
      objectType([{ key: 'value', type: iteratorCompletionValue(R) }, { key: 'done', type: booleanLiteral(true) }]),
    ],
  } as unknown as TypeRecord;
}

/**
 * Build one of the iteration interfaces, or null where the name is not one.
 *
 * A bare argument is the first and the rest default to ~void~, as they do for
 * generators. Full generator operation results additionally include exhaustion;
 * generatorImplements derives their compatible structural views separately.
 */
/**
 * The members of these interfaces are METHODS, and a method is an OUTPUT
 * position - #sec-generic-variance groups "a method return or a `readonly`
 * field" together as exactly that. So they are marked readonly, which is what
 * makes #sec-isobjectsubtype compare them by IsSubtype and let function
 * subtyping decide their variance, rather than by the invariance that clause
 * requires of a WRITABLE data member.
 */
export function iterationInterfaceRecord(name: string, args: readonly (TypeRecord | number)[] = []): TypeRecord | null {
  if (!BUILTIN_INTERFACES.has(name)) {
    return null;
  }
  // Keep shorthand defaults shared. The generator's body R and its completed
  // operation result are distinct even when the default spellings agree.
  const [T, R, N] = iterationArguments(args);

  switch (name) {
    case 'IteratorResult':
      return iteratorResult(T, R);
    case 'PromiseSettledResult':
      // `status` is `string` and not a literal union of `'fulfilled'` and
      // `'rejected'`. That is what the design states, and narrowing it here
      // would be this engine improving on the document rather than implementing
      // it; if the union is wanted it is a change to `standardlibrary.md` first.
      //
      // `value` and `reason` are OPTIONAL, which is what makes one record serve
      // both outcomes - a fulfilled result carries no reason and a rejected one
      // no value.
      return objectType([
        { key: 'status', type: makePrimitive('string') },
        { key: 'value', type: T, optional: true },
        { key: 'reason', type: R, optional: true },
      ]);
    case 'Iterator':
    case 'AsyncIterator': {
      // proposal-runtime-types (higherkindedtypes.md): ONE declaration for both
      // protocols, differing only in the wrapper its results carry.
      // `Iterator<T, R, N, W<_> = Identity>` is the synchronous form and
      // `Iterator<T, R, N, Promise>` the asynchronous one.
      //
      // The wrapper goes LAST because the ordinary well-formedness rule puts it
      // there - a defaulted parameter may not precede a required one - so
      // `Iterator.<uint8>` reads exactly as it did before this unification, and
      // no annotation naming an iteration type had to move.
      const wrap = (result: TypeRecord) => (name === 'AsyncIterator' ? promiseOf(result) : result);
      return objectType([
        { key: 'next', type: methodType([N], wrap(iteratorResult(T, R))), readonly: true },
        { key: 'return', type: methodType([R], wrap(iteratorResult(T, R))), optional: true, readonly: true },
        { key: 'throw', type: methodType([anyType], wrap(iteratorResult(T, R))), optional: true, readonly: true },
      ]);
    }
    case 'Iterable':
      return objectType([
        { key: Symbol.for('iterator'), type: methodType([], iterationInterfaceRecord('Iterator', [T])!), readonly: true },
      ]);
    case 'IterableIterator':
      return objectType([
        ...(iterationInterfaceRecord('Iterator', [T, R, N]) as unknown as { Properties: never[] }).Properties,
        { key: Symbol.for('iterator'), type: methodType([], iterationInterfaceRecord('Iterator', [T, R, N])!) },
      ] as never);

    case 'AsyncIterable':
      return objectType([
        { key: Symbol.for('asyncIterator'), type: methodType([], iterationInterfaceRecord('AsyncIterator', [T])!) },
      ]);
    case 'AsyncIterableIterator':
      return objectType([
        ...(iterationInterfaceRecord('AsyncIterator', [T, R, N]) as unknown as { Properties: never[] }).Properties,
        { key: Symbol.for('asyncIterator'), type: methodType([], iterationInterfaceRecord('AsyncIterator', [T, R, N])!) },
      ] as never);
    default:
      return null;
  }
}

function promiseOf(t: TypeRecord): TypeRecord {
  // Preserve the library declaration identity when this protocol contribution
  // becomes a published runtime return contract.
  return libraryTypeRecord('Promise', [t, anyType])!;
}

/** #sec-async-generator-return-admission: raw input is not a fulfillment proof. */
function asyncGeneratorReturnInput(type: TypeRecord): TypeRecord {
  if (type.Kind === 'any') return type;
  // Like a typed Promise resolver, accept promises and callable thenables
  // without pretending their eventual value is already admitted. Incompatible
  // direct scalars remain visible to the ordinary call checker.
  // Assimilation supplies callable values, not arbitrary scalar arguments.
  // They accept an optional gradual payload; the result is deliberately
  // gradual, so this view does not invent a result obligation for a thenable.
  const callback = fnType([anyType], anyType);
  const then: TypeRecord = { Kind: 'function', Signatures: [{
    Parameters: [parameter(callback), parameter(callback)], Return: anyType,
  }] };
  const thenable = objectType([{ key: 'then', type: then }]);
  return CanonicalizeType({ Kind: 'union', Members: [
    type.Kind === 'void' ? makePrimitive('undefined') : type,
    promiseOf(anyType), thenable,
  ] });
}

/** #sec-generator-operation-results: an exhausted generator also completes with undefined. */
export function generatorCompletionValue(type: TypeRecord): TypeRecord {
  return CanonicalizeType({ Kind: 'union', Members: [iteratorCompletionValue(type), makePrimitive('undefined')] });
}

/** A generator's operation results include exhaustion; its body and inputs retain R. */
export function generatorProtocolRecord(name: 'Generator' | 'AsyncGenerator', args: readonly (TypeRecord | number)[]): TypeRecord {
  const [Y, R, N] = iterationArguments(args);
  const asynchronous = name === 'AsyncGenerator';
  const result = iteratorResult(Y, generatorCompletionValue(R));
  const wrapped = asynchronous ? promiseOf(result) : result;
  return objectType([
    { key: 'next', type: fnType([N], wrapped) },
    { key: 'return', type: fnType([asynchronous ? asyncGeneratorReturnInput(R) : R], wrapped) },
    { key: 'throw', type: fnType([anyType], wrapped) },
    { key: Symbol.for(asynchronous ? 'asyncIterator' : 'iterator'), type: fnType([], libraryTypeRecord(name, [Y, R, N])!) },
  ]);
}

/** Read contract only: ordinary lookup, replacement and receiver binding still apply. */
export function generatorPropertyType(type: TypeRecord | null, key: string | typeof wellKnownSymbols.iterator): TypeRecord | null {
  if (type?.Kind !== 'nominal' || (type.LibraryName !== 'Generator' && type.LibraryName !== 'AsyncGenerator')) return null;
  const shape = generatorProtocolRecord(type.LibraryName, type.Arguments);
  return shape.Kind === 'object' ? shape.Properties.find((property) => property.key === key)?.type ?? null : null;
}

function generatorImplements(name: 'Generator' | 'AsyncGenerator', args: readonly (TypeRecord | number)[]): TypeRecord[] {
  const [Y, R, N] = iterationArguments(args);
  const prefix = name === 'AsyncGenerator' ? 'Async' : '';
  const completed = generatorCompletionValue(R);
  const result = [generatorProtocolRecord(name, args), iterationInterfaceRecord(`${prefix}Iterable`, [Y])!];
  // Optional R already admits undefined. A protocol spelling either input
  // domain is valid only when its completed value also matches this generator.
  // The test matters for void and open R: R|undefined must not turn a discard
  // contract into a false guarantee of undefined.
  for (const terminal of [R, CanonicalizeType({ Kind: 'union', Members: [R, makePrimitive('undefined')] })]) {
    if (SameType(completed, CanonicalizeType(iteratorCompletionValue(terminal)))) {
      result.push(iterationInterfaceRecord(`${prefix}Iterator`, [Y, terminal, N])!,
        iterationInterfaceRecord(`${prefix}IterableIterator`, [Y, terminal, N])!);
    }
  }
  return result;
}

// REMAINDER — one symptom left.
//
// `IteratorResult` resolves bare in an evaluated position and applied in a
// parameter annotation, and fails only as `const r: IteratorResult.<uint8> = …`,
// reporting "is not defined". Ruled out by test: the arity, a `void` type
// argument, the missing runtime resolver, and answering the name in
// TypeNodeToTypeRecord's throw-recovery branch.
//
// It is the one member of this family whose record is a ~union~ where the rest
// are ~object~, and the evaluated path attaches type arguments only to a record
// that can carry them. Everything else here works.

/**
 * What a built-in nominal type DECLARES it implements.
 *
 * A library type is an opaque nominal here — its members live in side tables
 * consulted at the member-access site, never on the record — so it has no
 * structural form to compare against an interface. The relation is therefore a
 * DECLARATION rather than an inspection, which is what the specification says
 * and what makes it the fast path: a brand check rather than a member walk.
 *
 * Each entry is a function of the source's own arguments, since what a
 * `Map.<K, V>` implements is `Iterable.<[K, V]>` rather than a constant. Each
 * is also a claim kept true by hand, which is why every one has a test.
 */
const LIBRARY_EXTENDS: Record<string, string> = {
  AggregateError: 'Error', EvalError: 'Error', RangeError: 'Error',
  ReferenceError: 'Error', SyntaxError: 'Error', TypeError: 'Error', URIError: 'Error',
};
export function libraryExtends(name: string | undefined, target: string | undefined): boolean {
  if (name === undefined || target === undefined) { return false; }
  let current: string | undefined = LIBRARY_EXTENDS[name];
  while (current !== undefined) {
    if (current === target) { return true; }
    current = LIBRARY_EXTENDS[current];
  }
  return false;
}

const BUILTIN_IMPLEMENTS: Record<string, (args: readonly (TypeRecord | number)[]) => TypeRecord[]> = {
  Generator: (a) => generatorImplements('Generator', a),
  AsyncGenerator: (a) => generatorImplements('AsyncGenerator', a),
  // The helper methods return the CLASS - which is what the run time returns -
  // and it satisfies the protocols through this table, so a chain stays on a
  // record that carries its element type and the next helper can find it.
  Iterator: (a) => [
    iterationInterfaceRecord('IterableIterator', a)!,
    iterationInterfaceRecord('Iterator', a)!,
    iterationInterfaceRecord('Iterable', [a[0]])!,
  ],
  AsyncIterator: (a) => [
    iterationInterfaceRecord('AsyncIterableIterator', a)!,
    iterationInterfaceRecord('AsyncIterator', a)!,
    iterationInterfaceRecord('AsyncIterable', [a[0]])!,
  ],
  // The carrier the helpers return, declared to implement exactly what a
  // generator does so a chain assigns to any of the protocols.
  IteratorHelper: (a) => [
    iterationInterfaceRecord('IterableIterator', a)!,
    iterationInterfaceRecord('Iterator', a)!,
    iterationInterfaceRecord('Iterable', [a[0]])!,
  ],
  AsyncIteratorHelper: (a) => [
    iterationInterfaceRecord('AsyncIterableIterator', a)!,
    iterationInterfaceRecord('AsyncIterator', a)!,
    iterationInterfaceRecord('AsyncIterable', [a[0]])!,
  ],
  Set: (a) => [iterationInterfaceRecord('Iterable', [a[0]])!],
  // A tuple's Elements are TupleElementRecords, not bare types - built by hand
  // the entry produced a record nothing matched, and `Map` silently was not
  // iterable while `Set` was.
  Map: (a) => [iterationInterfaceRecord('Iterable', [
    {
      Kind: 'tuple',
      Elements: [a[0], a[1]].map((t) => ({ Type: t as TypeRecord, Rest: false, Initial: 'none' })),
    } as unknown as TypeRecord,
  ])!],
};

/** Whether a built-in nominal declares that it implements `target`. */
export function builtinImplements(
  libraryName: string | undefined,
  args: readonly (TypeRecord | number)[],
  matches: (declared: TypeRecord) => boolean,
): boolean {
  if (!libraryName) {
    return false;
  }
  const entry = BUILTIN_IMPLEMENTS[libraryName];
  if (!entry) {
    return false;
  }
  return entry(args).some((declared) => declared !== null && matches(declared));
}
