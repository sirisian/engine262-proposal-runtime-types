import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * One VALUE-LEVEL test per Type Record kind.
 *
 * `~intersection~` reached the runtime with no branch in `CheckedConvertValue`,
 * so no value could satisfy an intersection at all - and nothing caught it,
 * because all sixteen intersection declarations in the suite were `keyof`,
 * interning, assignability, or reflection. Every one compared TYPES; none bound
 * a VALUE, which is the only thing that reaches conversion.
 *
 * So this file is not a thorough test of any kind - each has its own file. It
 * exists so that a kind reaching the runtime untested is a failure rather than a
 * discovery, which is what `~intersection~` was. A kind added to
 * sec-type-records without a row here is the next one.
 */

const META = 'type B = { m: number }; meta B { default = { m: 0 }; subtype(a, b) { return a.m === b.m; } validate(v, c) { return true; } } '
  + 'primitive float64 { operator float64.<{ m: 1 }>(): float64.<{ m: 1 }> { return this; } } ';

test('every Type Record kind admits a value', () => {
  // ~primitive~, ~literal~, ~any~
  expect(evaluated('let x: uint8 = 5; String(Number(x));')).toBe('5');
  expect(evaluated('type L = 5; let x: L = 5; String(Number(x));')).toBe('5');
  expect(evaluated('let x: any = 5; String(x);')).toBe('5');

  // ~union~ and ~intersection~, side by side: one member versus every member.
  expect(evaluated('type U = uint8 | null; let x: U = 5; String(Number(x));')).toBe('5');
  expect(evaluated('type A = { a: uint8 }; type B2 = { b: uint8 }; type C = A & B2; let c: C = { a: 1, b: 2 }; String(Number(c.a));')).toBe('1');

  // ~object~, ~array~, ~tuple~
  expect(evaluated('type O = { a: uint8 }; let o: O = { a: 1 }; String(Number(o.a));')).toBe('1');
  expect(evaluated('let a: [].<uint8> = [1, 2]; String(Number(a[0]));')).toBe('1');
  expect(evaluated('let t: [uint8, uint8] = [1, 2]; String(Number(t[0]));')).toBe('1');

  // ~nominal~, including an enum, and ~function~
  expect(evaluated('class K { constructor() { this.v = 1; } } let k: K = new K(); String(k.v);')).toBe('1');
  expect(evaluated('enum E: uint8 { A, B } let e: E = E.A; String(Number(e));')).toBe('0');
  expect(evaluated('let f: (x: uint8) => uint8 = (x) => x; String(Number(f(5)));')).toBe('5');

  // ~reference~ and ~shared~
  expect(evaluated('function f(ref x: uint8) { x = 2; } let v: uint8 = 1; f(ref v); String(Number(v));')).toBe('2');
  expect(evaluated('let s: shared uint8 = 1; String(Number(s));')).toBe('1');

  // ~parameter~ (a generic parameter) and ~application~ (a generic instantiated)
  expect(evaluated('function f<T>(x: T): T { return x; } let n: uint8 = 5; String(Number(f.<uint8>(n)));')).toBe('5');
  expect(evaluated('type Box<T> = { v: T }; let b: Box.<uint8> = { v: 1 }; String(Number(b.v));')).toBe('1');

  // ~parameterized~ needs its metadata claimed and a conversion declared.
  expect(evaluated(`${META} let a: float64.<{ m: 1 }> = 5; String(Number(a));`)).toBe('5');
});

test('the kinds that admit NO value, or none of that shape', () => {
  // ~void~ is the type of a value there is none of; a `void` function's result
  // is `undefined` and reading it is the point being pinned.
  expect(evaluated('function f(): void { } String(typeof f());')).toBe('undefined');
  // ~never~ admits nothing at all.
  expectThrown('let n: never = 5;');
  // And a value failing any member of an intersection is refused - the case
  // whose absence let the branch go missing.
  expectThrown('type A = { a: uint8 }; type B2 = { b: uint8 }; type C = A & B2; let c: C = { a: 1 };');
});
