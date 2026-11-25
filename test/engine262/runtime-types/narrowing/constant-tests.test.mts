import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * Question O, direction O1: a compile-time numeric constant is read in a test
 * as the literal of its value (#sec-narrowing), so `if` and `case` agree and a
 * named constant behaves as if it were written in place. `case 200 + 100` over
 * a `uint8` was refused as a test that can never succeed while
 * `if (x === 200 + 100)` was accepted; C# warns of the same comparison
 * (CS0652, "the constant is outside the range of type").
 *
 * The value is the one the comparison takes the constant at when it runs:
 * beside an integer the integer it folds to there (constant-beside-an-integer),
 * so `x === 1 / 2` is `x === 0`. The Number was read where the integer was
 * meant, and two tests were refused that can succeed: `if (x === 1 / 2)` over
 * a `uint8` "can never succeed", and `if (x < 511 / 2)` "can never fail", while
 * the first holds for 0 and the second fails for 255.
 */

const impossible = (source: string, shown: string) => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-impossible-test' } });
  expectThrown(source, shown);
};
const U8 = (test: string) => `const K = 200 + 100; const J = 2 + 3; function f(x: uint8) { if (${test}) return "T"; return "F"; } [f(0), f(5), f(255)].join();`;

test('a constant the type cannot hold can never be equal to a value of it, as a literal cannot', () => {
  impossible(U8('x === 200 + 100'), 'the "300" test can never succeed');
  impossible(U8('x === K'), 'the "300" test can never succeed');
  impossible(U8('x !== 200 + 100'), 'the "300" test can never fail');
  impossible(U8('200 + 100 === x'), 'the "300" test can never succeed');
  impossible(U8('x === 0 - 1'), 'the "-1" test can never succeed');
  impossible('function f(x: int8) { if (x === -100 - 29) return 1; return 0; }', 'the "-129" test can never succeed');
  impossible('function f(x: decimal64) { if (x === 1e400 * 1) return 1; return 0; }', 'the "1e400 * 1" test can never succeed');
  impossible('function f(x: float64) { if (x === 1e400 * 1) return 1; return 0; }', 'the "1e400 * 1" test can never succeed');
  impossible('enum E { A = 1, B = 2 } function f(x: E) { if (x === 1 + 2) return 1; return 0; }', 'the "3" test can never succeed');
  // In every position a test is: a conditional, a loop, a member path.
  impossible('function f(x: uint8) { return x === 200 + 100 ? 1 : 0; }', 'can never succeed');
  impossible('function f(x: uint8) { while (x === 200 + 100) { return 1; } return 0; }', 'can never succeed');
  impossible('function f(o: { x: uint8 }) { if (o.x === 200 + 100) return 1; return 0; }', 'can never succeed');
  // As a literal of that value is: `==` is not judged for one.
  expect(evaluated(U8('x == 200 + 100'))).toBe('F,F,F');
});

test('a constant the type holds is the literal of its value', () => {
  expect(evaluated(U8('x === 2 + 3'))).toBe('F,T,F');
  expect(evaluated(U8('x === J'))).toBe('F,T,F');
  // A test of a value an earlier test settled, as for the literal.
  impossible('function f(x: uint8) { if (x === 5) return 1; else if (x === 2 + 3) return 2; return 0; }', 'the "5" test can never succeed');
  impossible('const J = 2 + 3; function f(x: uint8) { if (x === J) return 1; else if (x === 5) return 2; return 0; }', 'the "5" test can never succeed');
  // A `case` label whose value an earlier label tested.
  impossible('function f(x: uint8) { switch (x) { case 200: return 1; case 100 + 100: return 2; } return 0; }', 'the "200" test can never succeed');
  impossible('const K = 100 + 100; function f(x: uint8) { switch (x) { case 200: return 1; case K: return 2; } return 0; }', 'the "200" test can never succeed');
  // Over a decimal, by its exact value: `0.1 + 0.2` is 0.3 there.
  expect(evaluated('function f(x: decimal64) { if (x === 0.1 + 0.2) return "T"; return "F"; } [f(0.3), f(0.4)].join();')).toBe('T,F');
});

test('beside an integer, a constant is the integer it folds to, as the comparison reads it', () => {
  // `1 / 2` beside a `uint8` is 0, so the test succeeds for 0.
  expect(evaluated('function f(x: uint8) { if (x === 1 / 2) return "T"; return "F"; } [f(0), f(1)].join();')).toBe('T,F');
  expect(evaluated('function f(x: uint8) { if (x !== 1 / 2) return "T"; return "F"; } [f(0), f(1)].join();')).toBe('F,T');
  expect(evaluated('function f(x: uint8) { switch (x) { case 1 / 2: return "T"; } return "F"; } [f(0), f(1)].join();')).toBe('T,F');
  // `511 / 2` is 255: `x < 255` fails for 255, and `x >= 255` succeeds for it.
  expect(evaluated('function f(x: uint8) { if (x < 511 / 2) return "T"; return "F"; } [f(0), f(255)].join();')).toBe('T,F');
  expect(evaluated('function f(x: uint8) { if (x >= 511 / 2) return "T"; return "F"; } [f(0), f(255)].join();')).toBe('F,T');
  impossible('function f(x: uint8) { if (x <= 511 / 2) return 1; return 0; }', 'the "<= 255" test can never fail');
  impossible('function f(x: uint8) { if (x > 511 / 2) return 1; return 0; }', 'the "> 255" test can never succeed');
  impossible('function f(x: uint8) { if (x < 1 / 2) return 1; return 0; }', 'the "< 0" test can never succeed');
  // A named constant as if written in place.
  impossible('const K = 0 * 1; function f(x: uint8) { if (x < K) return 1; return 0; }', 'the "< 0" test can never succeed');
  impossible('const K = 510 / 2; function f(x: uint8) { if (x <= K) return 1; return 0; }', 'the "<= 255" test can never fail');
});

test('a literal beside a union of numeric types is read at each of them', () => {
  // A literal takes the type of the value it is compared with when it runs,
  // so `x === 5` for a `uint16` 5 is true. Each such test was refused as one
  // that can never succeed.
  expect(evaluated('function f(x: uint8 | uint16) { if (x === 5) return "T"; return "F"; } [f(5 := uint8), f(5 := uint16), f(6 := uint16)].join();')).toBe('T,T,F');
  expect(evaluated('function f(x: uint8 | uint16) { if (x === 300) return "T"; return "F"; } [f(300 := uint16), f(5 := uint8)].join();')).toBe('T,F');
  expect(evaluated('function f(x: uint8 | uint16) { if (x !== 5) return "T"; return "F"; } f(5 := uint16);')).toBe('F');
  expect(evaluated('function f(x: uint8 | float32) { if (x === 0.5) return "T"; return "F"; } f(0.5 := float32);')).toBe('T');
  expect(evaluated('const K = 5; function f(x: uint8 | uint16) { if (x === K) return "T"; return "F"; } f(5 := uint16);')).toBe('T');
  // Where no member holds it, it can never succeed.
  impossible('function f(x: uint8 | uint16) { if (x === 70000) return 1; return 0; }', 'the "70000" test can never succeed');
});

test('two constants compared with each other are not a test of a value', () => {
  expect(evaluated('function f() { if (200 + 100 === 5 + 5) return "T"; return "F"; } f();')).toBe('F');
  expect(evaluated('const K = 2 + 3; const J = 1 + 3; function f() { if (K === J) return "T"; return "F"; } f();')).toBe('F');
});
