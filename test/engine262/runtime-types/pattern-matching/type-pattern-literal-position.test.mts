import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * #sec-match-patterns: a brace or bracket shape every one of whose elements is
 * a type is read as the type, "the two readings agreeing there", and a literal
 * pattern and a literal type "coincide ... the semantics are one". A numeric
 * literal type in such a shape stayed a literal of `number`, so `o is { a: 1 }`
 * for an `o: { a: uint8 }` holding 1 was *false*, `when [1, 2]` over a
 * `[uint8, uint8]` missed, and `when { a: 1 }` was refused as unable to match,
 * where `k is 1` takes the `uint8` of its position. It takes its position's
 * numeric type now, as the literal pattern does.
 */

const O = 'function f(o: { a: uint8 }) { return ';

test('a literal type in an object type pattern takes its member\'s type', () => {
  expect(evaluated(`${O}o is { a: 1 }; } String(f({ a: 1 })) + String(f({ a: 2 }));`)).toBe('truefalse');
  expect(evaluated(`${O}o is { a: 1 | 2 }; } String(f({ a: 2 }));`)).toBe('true');
  expect(evaluated(`${O}match (o) { when { a: 1 }: "one"; when _: "other"; }; } f({ a: 1 }) + f({ a: 3 });`)).toBe('oneother');
  expect(evaluated(`${O}match (o) { when { a: 1 } or { a: 2 }: "x"; when _: "o"; }; } f({ a: 2 }) + f({ a: 3 });`)).toBe('xo');
  expect(evaluated('function f(o: { p: { a: int8 }, s: string }) { return o is { p: { a: -1 }, s: "x" }; } String(f({ p: { a: -1 }, s: "x" }));')).toBe('true');
  expect(evaluated('function f(o: { a: float32 }) { return o is { a: 0.1 }; } String(f({ a: 0.1 }));')).toBe('true');
  expect(evaluated('function f(o: { a: int64 }) { return o is { a: 5 }; } String(f({ a: 5 }));')).toBe('true');
  expect(evaluated('class P { a: uint8 = 1; } function f(p: P) { return p is { a: 1 }; } String(f(new P()));')).toBe('true');
});

test('at a decimal or a float128 member, the literal is read at the type from its digits', () => {
  const D = 'function f(o: { a: decimal64 }) { return ';
  expect(evaluated(`${D}o is { a: 1 }; } String(f({ a: 1 })) + String(f({ a: 2 }));`)).toBe('truefalse');
  expect(evaluated(`${D}o is { a: 0.1 }; } String(f({ a: decimal64.parse("0.1") }));`)).toBe('true');
  expect(evaluated(`${D}match (o) { when { a: 1 }: "one"; when _: "o"; }; } f({ a: 1 });`)).toBe('one');
  // As a literal pattern compares within the type, a decimal's cohort member
  // counts: `k is 1.50` is *false* for a `k` holding 1.5, and so is this.
  expect(evaluated(`${D}o is { a: 1.50 }; } String(f({ a: decimal64.parse("1.5") }));`)).toBe('false');
  expect(evaluated('function f(k: decimal64) { return k is 1.50; } String(f(decimal64.parse("1.5")));')).toBe('false');
  expect(evaluated('function f(o: { a: float128 }) { return o is { a: 1 }; } String(f({ a: 1 }));')).toBe('true');
});

test('a literal type in a tuple type pattern takes its element\'s type', () => {
  const T = 'function f(t: [uint8, uint8]) { return ';
  expect(evaluated(`${T}t is [1, 2]; } String(f([1, 2])) + String(f([1, 3]));`)).toBe('truefalse');
  expect(evaluated(`${T}match (t) { when [1, 2]: "yes"; when _: "no"; }; } f([1, 2]);`)).toBe('yes');
});

test('the narrowed member reads as its type', () => {
  expect(evaluated(`${O}(o is { a: 1 }) ? String(o.a + 1) : "no"; } f({ a: 1 });`)).toBe('2');
});

test('where the position does not settle one numeric type, the literal keeps its reading', () => {
  expect(evaluated('function f(o: { a: number }) { return o is { a: 1 }; } String(f({ a: 1 }));')).toBe('true');
  expect(evaluated('function f(o) { return o is { a: 1 }; } String(f({ a: 1 })) + String(f({ a: uint8(1) }));')).toBe('truefalse');
  expect(evaluated(`${O}o is { a: 300 }; } String(f({ a: 1 }));`)).toBe('false');
  expectStaticTypeError(`${O}match (o) { when { a: 300 }: "x"; when _: "o"; }; }`);
  // An alias's literal type is a literal of `number` by its declaration.
  expect(evaluated('type One = { a: 1 }; function f(o: { a: uint8 }) { return o is One; } String(f({ a: 1 }));')).toBe('false');
});
