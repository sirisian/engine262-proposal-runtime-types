import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * proposal-runtime-types `#sec-type-names`: a type position names a TYPE. A
 * binding that merely HOLDS a value does not become one, however precisely that
 * value's type is known.
 *
 * `PLAN-Q3-value-binding-as-type.md`. The engine used to admit some of them,
 * because `isTypeObject` tested only for the presence of a [[TypeRecord]] slot
 * and a typed primitive carries one - that is how `RuntimeTypeOf` reports the
 * type of `(5 := uint8)`. The result was a feature nobody wrote and nobody could
 * predict: `const q: uint8 = 1; let v: q = 2;` resolved, `const s: string = "a";
 * let v: s` did not, and `decimal128` crashed the host outright. The difference
 * was whether the value happened to carry a record, which is an implementation
 * fact rather than a rule a reader could learn.
 *
 * Two spellings say what was meant, and both are specified:
 *   - `const T = type uint8;  let v: T`      - name the type
 *   - `let v: Reflect.typeOf(q)`             - query the value's type
 */

/** Every one of these is a binding holding a value, not a type. */
const VALUE_BINDINGS: readonly (readonly [string, string])[] = [
  ['uint8', 'const q: uint8 = 1; let v: q = 2;'],
  ['uint16', 'const q: uint16 = 1; let v: q = 2;'],
  ['float32', 'const q: float32 = 1.5; let v: q = 2.5;'],
  ['float64', 'const q: float64 = 1.5; let v: q = 2.5;'],
  ['decimal128', 'const q: decimal128 = decimal128("1.0"); let v: q = decimal128("2.0");'],
  ['an enum member', 'enum E { A } const q: E = E.A; let v: q = E.A;'],
  ['string', 'const q: string = "a"; let v: q = "b";'],
  ['boolean', 'const q: boolean = true; let v: q = false;'],
  ['an object type', 'const q: { a: uint8 } = { a: 1 }; let v: q = { a: 2 };'],
  ['a class instance', 'class C { n: uint8 = 1; } const q: C = new C(); let v: q = new C();'],
  ['an array', 'const q: [].<uint8> = [1]; let v: q = [2];'],
];

test('a binding that holds a value is not a type', () => {
  for (const [, source] of VALUE_BINDINGS) {
    // A TypeError, uniformly - not a RangeError from a conversion the engine
    // should never have reached, and not a host crash.
    expectThrownKind(source, 'TypeError');
  }
});

test('the numeric cases in particular, which used to resolve', () => {
  // These are the ones that worked, and they worked precisely enough to look
  // deliberate: the width was tracked, so `uint8` refused 300 and `uint16`
  // accepted it. Precision is not the same as intent.
  expectThrownKind('const q: uint8 = 1; let v: q = 300;', 'TypeError');
  expectThrownKind('const q: uint16 = 1; let v: q = 70000;', 'TypeError');
});

test('decimal no longer crashes the host', () => {
  // `'TypeRecord' in value` is true of a slot that exists and holds nothing, so
  // a decimal reached a walk that read `record.Kind` off undefined and took the
  // process down. A JavaScript error is the whole of what is wanted here.
  expectThrownKind('const q: decimal128 = decimal128("1.0"); let v: q = decimal128("2.0");', 'TypeError');
  // and the value itself is untouched
  expect(evaluated('const q: decimal128 = decimal128("1.0"); String(q.toString());')).toBe('1.0');
});

test('the two spellings that DO name a type still work', () => {
  // Name it.
  expect(evaluated('const T = type uint8; let v: T = 2; String(v);')).toBe('2');
  expectThrownKind('const T = type uint8; let v: T = 300;', 'RangeError');
  // Or query it.
  expect(evaluated('const q: uint8 = 1; let v: Reflect.typeOf(q) = 2; String(v);')).toBe('2');
  expectThrownKind('const q: uint8 = 1; let v: Reflect.typeOf(q) = 300;', 'RangeError');
});
