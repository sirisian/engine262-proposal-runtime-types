import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Question AV: a read of a declared enumerator is judged where a declared type
 * receives it, as a value of its enum is. The read keeps no Static Type (round
 * 4, Q7), so no judgment against a declared type saw it: `const b: boolean =
 * E.A` was a TypeError only when it ran, where `const b: boolean = e` for an
 * `e: E` is refused before running. It is judged at the enumerator's literal
 * where that is known, and at its enum where it is not (#sec-enums). Tests,
 * `match`, narrowing and inference see the read as before.
 */

const E = 'enum E : uint8 { A = 1, B = 2 } ';

test('each position a declared type receives judges the read before running', () => {
  for (const body of [
    'const b: boolean = E.A;',
    'let n: uint16 = E.A;',
    'let s: string = E.A;',
    'let b: boolean = true; b = E.A;',
    'let b: boolean = false; b ||= E.A;',
    'function f(x: boolean) { return x; } f(E.A);',
    'function f(...xs: [].<boolean>) { return xs; } f(E.A);',
    'function f({ x }: { x: boolean }) { return x; } f({ x: E.A });',
    'function f(b: boolean = E.A) { return b; } f();',
    'function f(): boolean { return E.A; } f();',
    'const h = (): boolean => E.A; h();',
    'function* g(): Generator.<boolean> { yield E.A; } [...g()];',
    'class K { b: boolean = E.A; } new K();',
    'class K { b: boolean = true; } const k = new K(); k.b = E.A;',
    'const a: [].<boolean> = [true]; a[0] = E.A;',
    'const a: [].<boolean> = [E.A];',
    'const t: [boolean] = [E.A];',
    'const o: { b: boolean } = { b: E.A };',
    'const b: boolean = (E.A);',
    'let x: E.B = E.A;',
  ]) expectStaticTypeError(`${E}${body}`);
  expectStaticTypeError('enum P { A, B } const n: number = P.A;');
  expectStaticTypeError('enum S : string { A = "a" } const n: number = S.A;');
  // An enumerator initialized by a function has no known literal, and is
  // judged as a value of its enum.
  expectStaticTypeError('enum R { A = (i, n) => i * 10, B } function f(x: boolean) { return x; } f(R.A);');
});

test('what the enum admits is admitted', () => {
  expect(evaluated(`${E}let x: E = E.A; let n: uint8 = E.B; String(x) + " " + String(n);`)).toBe('1 2');
  expect(evaluated(`${E}let x: E.A = E.A; let y: E.A | E.B = E.B; let u: uint8 | string = E.A; String(x) + String(y) + String(u);`)).toBe('121');
  expect(evaluated(`${E}function f(x: E) { return x; } const o: { b: uint8 } = { b: E.A }; String(f(E.B)) + String(o.b);`)).toBe('21');
  expect(evaluated('enum S : string { A = "a" } const s: string = S.A; s;')).toBe('a');
  expect(evaluated('enum P { A, B } const n: int32 = P.B; String(n);')).toBe('1');
  expect(evaluated('enum R { A = (i, n) => i * 10, B } function f(x: int32) { return x; } String(f(R.B));')).toBe('10');
});

test('a refinement still decides an enumerator by its predicate', () => {
  expect(evaluated(`${E}type Late = E where this > E.A; let x: Late = E.B; String(x);`)).toBe('2');
  expectStaticTypeError(`${E}type Late = E where this > E.A; let x: Late = E.A;`);
});

test('the read keeps no Static Type of its own', () => {
  expect(evaluated(`${E}String(E.A === 1) + " " + String(E.A === E.B);`)).toBe('true false');
  expect(evaluated(`${E}const x = E.A; String(x is E);`)).toBe('true');
  expect(evaluated(`${E}let c: E = E.A; String(c === E.B);`)).toBe('false');
  expect(evaluated(`${E}function f(c: E) { return match (c) { when E.A: "a"; when E.B: "b"; }; } f(E.B);`)).toBe('b');
  expect(evaluated(`${E}String(match (E.B) { when E.B: "b"; });`)).toBe('b');
  // An operator that does not store its right operand as it is, is judged as
  // an operator: `s += E.A` concatenates.
  expect(evaluated(`${E}let s: string = "s"; s += E.A; let x: uint8 = 1; x += E.A; s + String(x);`)).toBe('s12');
});
