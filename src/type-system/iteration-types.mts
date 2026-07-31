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

// REMAINDER — one name left, and the reason changed again.
//
// `Iterator` and the four protocol interfaces now resolve in every position,
// including a `const` annotation, once the records carried IndexSignatures and
// the runtime resolver was wired. `Iterator.<uint8> === Iterator.<uint8, void,
// void>` is *true*, so the shorthand interns.
//
// `IteratorResult` still fails, and no longer with "is not a type" — it now
// reports "is not defined", which is a different thing. That is a VALUE lookup
// failing, not a type lookup: in this design types are values, so a `const T =`
// annotation evaluates its annotation as an expression, and `Iterator` survives
// that because it is a real global while `IteratorResult` is not bound at all.
//
// So the remaining work is not another resolver. These types need to be
// BINDINGS — global Type Objects, the way the built-in numeric type names are —
// rather than only entries a resolver can answer with. That is the mechanism to
// find next, and it is likely to make the resolver entries redundant for the
// names that get bindings.
