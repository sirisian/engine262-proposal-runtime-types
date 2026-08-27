// The iteration types, per proposal-runtime-types #sec-iteration-types.
//
// These are built-in INTERFACES rather than library classes: the protocols are
// satisfied structurally, because `for`-`of` asks whether [Symbol.iterator] is
// callable and never asks what a value declared. A type refusing a hand-written
// `{ next() { … } }` would describe a language this is not.
//
// PLAN-iteration-types-engine.md phase 2. `IteratorResult` comes first because
// it is what `next` returns and nothing else can be written before it.

import type { TypeRecord } from './records.mts';
import {
  anyType, makePrimitive, parameter, iterationArguments,
} from './records.mts';
import { wellKnownSymbols, Value } from '#self';

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
let parsedIdentityDeclaration: TypeRecord | null = null;

/**
 * Record the `Identity` declaration a prelude parsed, so the global binding can
 * hold a PARSED node rather than an assembled one.
 *
 * A declaration built by hand satisfies the shape a type check reads without
 * satisfying the shape the runtime walks, and crashes at the first enforced
 * annotation. The parser produces the node every consumer expects.
 */
export function setParsedIdentityDeclaration(record: TypeRecord): void {
  parsedIdentityDeclaration = record;
}

/** The parsed `Identity` declaration, or null before a prelude has run. */
export function getParsedIdentityDeclaration(): TypeRecord | null {
  return parsedIdentityDeclaration;
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
 * binds `value` at T, the other at R. TypeScript needed a compiler flag to stop
 * the same shape leaking `any`; here the discriminant does that work.
 */
function iteratorResult(T: TypeRecord, R: TypeRecord): TypeRecord {
  return {
    Kind: 'union',
    Members: [
      objectType([{ key: 'value', type: T }, { key: 'done', type: booleanLiteral(false) }]),
      objectType([{ key: 'value', type: R }, { key: 'done', type: booleanLiteral(true) }]),
    ],
  } as unknown as TypeRecord;
}

/**
 * Build one of the iteration interfaces, or null where the name is not one.
 *
 * A bare argument is the first and the rest default to ~void~, which is the
 * shorthand the generator families already use. The agreement is deliberate: it
 * is what makes a `Generator.<Y, R, N>` satisfy `IterableIterator.<Y, R, N>`,
 * and choosing the defaults apart would have made a generator NEARLY an
 * iterator - the failure TypeScript documented when its builtin iterator type
 * and its generators disagreed on this parameter.
 */
/**
 * The members of these interfaces are METHODS, and a method is an OUTPUT
 * position - #sec-variance-annotations groups "a method return or a `readonly`
 * field" together as exactly that. So they are marked readonly, which is what
 * makes #sec-isobjectsubtype compare them by IsSubtype and let function
 * subtyping decide their variance, rather than by the invariance that clause
 * requires of a WRITABLE data member.
 */
export function iterationInterfaceRecord(name: string, args: readonly (TypeRecord | number)[] = []): TypeRecord | null {
  if (!BUILTIN_INTERFACES.has(name)) {
    return null;
  }
  // The shorthand comes from records.mts so that this family and the generator
  // families default identically - the agreement is what makes a Generator an
  // IterableIterator, and a second copy here is how it would drift.
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
        { key: 'next', type: fnType([N], wrap(iteratorResult(T, R))), readonly: true },
        { key: 'return', type: fnType([R], wrap(iteratorResult(T, R))), optional: true, readonly: true },
        { key: 'throw', type: fnType([anyType], wrap(iteratorResult(T, R))), optional: true, readonly: true },
      ]);
    }
    case 'Iterable':
      return objectType([
        { key: Symbol.for('iterator'), type: fnType([], iterationInterfaceRecord('Iterator', [T])!), readonly: true },
      ]);
    case 'IterableIterator':
      return objectType([
        ...(iterationInterfaceRecord('Iterator', [T, R, N]) as unknown as { Properties: never[] }).Properties,
        ...(iterationInterfaceRecord('Iterable', [T]) as unknown as { Properties: never[] }).Properties,
      ] as never);

    case 'AsyncIterable':
      return objectType([
        { key: Symbol.for('asyncIterator'), type: fnType([], iterationInterfaceRecord('AsyncIterator', [T])!) },
      ]);
    case 'AsyncIterableIterator':
      return objectType([
        ...(iterationInterfaceRecord('AsyncIterator', [T, R, N]) as unknown as { Properties: never[] }).Properties,
        ...(iterationInterfaceRecord('AsyncIterable', [T]) as unknown as { Properties: never[] }).Properties,
      ] as never);
    default:
      return null;
  }
}

function promiseOf(t: TypeRecord): TypeRecord {
  return {
    Kind: 'nominal', Declaration: undefined, Arguments: [t, anyType], LibraryName: 'Promise',
  } as unknown as TypeRecord;
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
  Generator: (a) => [
    iterationInterfaceRecord('IterableIterator', a)!,
    iterationInterfaceRecord('Iterator', a)!,
    iterationInterfaceRecord('Iterable', [a[0]])!,
  ],
  AsyncGenerator: (a) => [
    iterationInterfaceRecord('AsyncIterableIterator', a)!,
    iterationInterfaceRecord('AsyncIterator', a)!,
    iterationInterfaceRecord('AsyncIterable', [a[0]])!,
  ],
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
