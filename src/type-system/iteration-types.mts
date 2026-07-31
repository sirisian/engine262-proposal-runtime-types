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
import { anyType, voidType, makePrimitive } from './records.mts';
import { wellKnownSymbols } from '#self';

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
  return {
    Kind: 'function',
    Signatures: [{
      Parameters: params.map((t, i) => ({
        Name: `arg${i}`, Type: t, Optional: true, Rest: false,
      })),
      Return: ret,
      Untyped: false,
    }],
  } as unknown as TypeRecord;
}

const booleanLiteral = (v: boolean): TypeRecord => ({
  Kind: 'literal', Value: v, Base: makePrimitive('boolean'),
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
export function iterationInterfaceRecord(name: string, args: readonly (TypeRecord | number)[] = []): TypeRecord | null {
  if (!BUILTIN_INTERFACES.has(name)) {
    return null;
  }
  const at = (i: number): TypeRecord => {
    const a = args[i];
    return typeof a === 'number' || a === undefined ? (i === 0 ? anyType : voidType) : a;
  };
  const T = at(0);
  const R = at(1);
  const N = at(2);

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

// REMAINDER — IteratorResult in an applied evaluated position.
//
// Five of six resolve everywhere. `IteratorResult` resolves bare in an
// evaluated position and applied in a parameter annotation; it fails only as
// `const r: IteratorResult.<uint8> = …`, reporting "is not defined".
//
// Ruled out by test, each cheap: the arity (the one-argument form fails the
// same), a `void` type argument (`Promise.<uint8, void>` resolves), and
// answering the name in TypeNodeToTypeRecord's throw-recovery branch beside the
// class-in-its-dead-zone case (written, rebuilt, no effect, reverted).
//
// What is known: the evaluated path resolves a name to a VALUE before applying
// type arguments, so a name with no binding has to be answered before GetValue
// propagates. `Iterable` and the rest survive because they are registered among
// the library type names; `IteratorResult` is registered identically and does
// not, and the one property distinguishing it is that its record is a ~union~
// where every other is an ~object~.
//
// The next step is to find where a library-registered name is answered on the
// evaluated path - `Promise.<uint8, void>` takes it and works - and see what it
// does with a record that has no [[Arguments]] to attach to. That is a question
// with a definite answer in one function, not a search.

/**
 * What a built-in nominal type DECLARES it implements.
 *
 * A library type is an opaque nominal here - its members live in side tables
 * consulted at the member-access site, never on the record - so it has no
 * structural form to compare against an interface, and nothing made a
 * `Generator` an `IterableIterator` even though both documents say it is one.
 *
 * The relation is a DECLARATION rather than an inspection, which is what the
 * specification says ("Iterator ... declares that it implements
 * IterableIterator") and what makes it the fast path: a brand check rather than
 * a member walk, with the walk reserved for hand-written values.
 *
 * Each entry is a function of the source's own arguments, since what a `Map.<K,
 * V>` implements is `Iterable.<[K, V]>` rather than a constant. Each entry is
 * also a claim that has to stay true by hand, which is why every one of them has
 * a test: the table IS the assertions.
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

// STATUS — the table is written and the relation does not yet hold.
//
// `builtinImplements` is wired into IsSubtype ahead of the kind guard, and
// `const i: Iterable.<uint8> = g()` for a generator still reports the generator
// as not assignable. IsAssignable does call IsSubtype, so the route is right;
// the step is not firing, and the reason is not yet known.
//
// What to check first, in order:
//   1. Whether the target record at that point is really ~object~. If the
//      interface reaches IsSubtype as something else - a parameterized wrapper,
//      or the interned Type Object rather than its record - the `t.Kind ===
//      'object'` guard is simply false and the step is skipped.
//   2. Whether the source's [[LibraryName]] is 'Generator' at that point, or
//      whether the generator's type arrives as something other than the library
//      nominal the annotation resolves to.
//   3. Whether an earlier branch answers first: the parameterized and
//      intersection branches both return before this point.
//
// A single trace at the top of IsSubtype printing both Kinds and LibraryNames
// for this case answers all three at once, and is the next thing to do.
