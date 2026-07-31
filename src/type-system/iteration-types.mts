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
