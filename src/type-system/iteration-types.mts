// The iteration types, per proposal-runtime-types #sec-iteration-types.
//
// These are built-in INTERFACES rather than library classes: the protocols are
// satisfied structurally, because `for`-`of` asks whether [Symbol.iterator] is
// callable and never asks what a value declared. A type refusing a hand-written
// `{ next() { â€¦ } }` would describe a language this is not.
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
  'Iterator', 'Iterable', 'IterableIterator',
  'AsyncIterator', 'AsyncIterable', 'AsyncIterableIterator',
]);

/** Whether a type name is one of the iteration interfaces. */
export function isIterationInterfaceName(name: string): boolean {
  return BUILTIN_INTERFACES.has(name);
}

function objectType(properties: { key: string | symbol, type: TypeRecord, optional?: boolean }[]): TypeRecord {
  return {
    Kind: 'object',
    Properties: properties.map((p) => ({
      key: typeof p.key === 'string'
        ? p.key
        : (wellKnownSymbols as unknown as Record<string, unknown>)[p.key.description!],
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
 * `IteratorResult.<T, R>` â€” a union of two object types discriminated by `done`.
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
    case 'Iterator':
      return objectType([
        { key: 'next', type: fnType([N], iteratorResult(T, R)) },
        { key: 'return', type: fnType([R], iteratorResult(T, R)), optional: true },
        { key: 'throw', type: fnType([anyType], iteratorResult(T, R)), optional: true },
      ]);
    case 'Iterable':
      return objectType([
        { key: Symbol.for('iterator'), type: fnType([], iterationInterfaceRecord('Iterator', [T])!) },
      ]);
    case 'IterableIterator':
      return objectType([
        ...(iterationInterfaceRecord('Iterator', [T, R, N]) as unknown as { Properties: never[] }).Properties,
        ...(iterationInterfaceRecord('Iterable', [T]) as unknown as { Properties: never[] }).Properties,
      ] as never);
    case 'AsyncIterator':
      return objectType([
        { key: 'next', type: fnType([N], promiseOf(iteratorResult(T, R))) },
        { key: 'return', type: fnType([R], promiseOf(iteratorResult(T, R))), optional: true },
        { key: 'throw', type: fnType([anyType], promiseOf(iteratorResult(T, R))), optional: true },
      ]);
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

// REMAINDER â€” one symptom left.
//
// `IteratorResult` resolves bare in an evaluated position and applied in a
// parameter annotation, and fails only as `const r: IteratorResult.<uint8> = â€¦`,
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
 * A library type is an opaque nominal here Ã¢â‚¬â€� its members live in side tables
 * consulted at the member-access site, never on the record Ã¢â‚¬â€� so it has no
 * structural form to compare against an interface. The relation is therefore a
 * DECLARATION rather than an inspection, which is what the specification says
 * and what makes it the fast path: a brand check rather than a member walk.
 *
 * Each entry is a function of the source's own arguments, since what a
 * `Map.<K, V>` implements is `Iterable.<[K, V]>` rather than a constant. Each
 * is also a claim kept true by hand, which is why every one has a test.
 */
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
  Map: (a) => [iterationInterfaceRecord('Iterable', [
    { Kind: 'tuple', Elements: [a[0], a[1]] } as unknown as TypeRecord,
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
