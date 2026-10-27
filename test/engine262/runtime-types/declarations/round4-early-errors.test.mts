import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, observeScript } from '../harness.mts';

/**
 * Round 4 of the early-error survey: void through a pattern, a
 * conditional and an object-literal value (#sec-void-type); BigInt zero
 * divisors and negative exponents (#sec-integer-operations); a constructor
 * declaring type parameters (#sec-type-parameters-static-semantics-early-errors);
 * and the implicit ToNumber stage of the Math functions
 * (#sec-proved-library-operations).
 */

const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule, phase: 'static' } });
};

test('void through a pattern, a conditional, and an object-literal value is refused', () => {
  refused('function f(): void {} const [y] = [f()];', 'rt-void-use');
  refused('function f(): void {} const y = true ? f() : f();', 'rt-void-use');
  refused('function f(): void {} const o = { x: f() };', 'rt-void-use');
  expect(evaluated('function f(): void {} let y = f(); "ok";')).toBe('ok');
});

test('a BigInt known-zero divisor and known-negative exponent are refused; shifts are not', () => {
  refused('let b: bigint = 1n; b / 0n;', 'rt-zero-divisor');
  refused('let b: bigint = 1n; b % 0n;', 'rt-zero-divisor');
  refused('let b: bigint = 2n; b ** -1n;', 'rt-zero-divisor');
  refused('function f(b: bigint) { return b / 0n; }', 'rt-zero-divisor');
  expect(evaluated('let b: bigint = 2n; String(b << -1n) + String(b ** 2n) + String(b / 2n);')).toBe('141');
  expect(evaluated('let n: number = 1; String(n / 0);')).toBe('Infinity');
});

test('a constructor declares no type parameters', () => {
  expectEarlyError('class C { constructor<T: type>(x: T) {} }', 'SyntaxError');
  expectEarlyError('class C { constructor<uint8>() {} }', 'SyntaxError');
  expect(evaluated('class C<T: type> { constructor(x: T) {} } "ok";')).toBe('ok');
});

test('a Symbol or BigInt at a Math function is refused; a patched Math is not', () => {
  refused('let s: symbol = Symbol(); Math.max(s);', 'rt-conversion-protocol');
  refused('let b: bigint = 1n; Math.abs(b);', 'rt-conversion-protocol');
  expect(evaluated('let n: uint8 = 1; String(Math.max(n, 2));')).toBe('2');
  expect(evaluated('Math.max = () => 0; let s: symbol = Symbol(); String(Math.max(s));')).toBe('0');
});
