import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-void-type: a concrete void type cannot form an actual binding.
test.each([
  'function f(x: void) {}',
  'function f(x?: void) {}',
  'class C { f(x: void) {} }',
  'async function f(x: void) {}',
  'function* f(x: void) {}',
  'function f({ (x: void) }) {}',
  'function f() { try {} catch (e: void) {} }',
  'function f(a: any) { let x: void = a; }',
  'type V = void; function f(x: V) {}',
  'type V = void; function f(a: any) { const x: V = a; }',
  'function f(a: any) { let { (x: void) } = a; }',
  'function f(a: any) { for (let x: void of a) {} }',
])('concrete void cannot form an actual binding: %s', expectStaticTypeError);

test.each([
  'function f(): void {}',
  'function f(x: undefined) {}',
  'type F = (x: void) => void;',
  'type G = Generator.<uint8, void, void>;',
  'function f<T: type>(x: T) {}',
])('void results, protocol types and unresolved parameters remain valid: %s', (source) => expect(ok(source)).toBe(true));

test.each([
  'function f<T: type>(x: T) {} const g = f.<void>;',
  'const g = f.<void>; function f<T: type>(x: T) {}',
  'function f<T: type>(a: any) { let x: T = a; } const g = f.<void>;',
  'class C { f<T: type>(x: T) {} } function use(c: C) { const g = c.f.<void>; }',
])('specialization rejects a newly concrete void binding: %s', expectStaticTypeError);

test.each([
  'function f<T: type>(): T { throw 0; } const g = f.<void>;',
  'function f<T: type>() { function inner<T: type>(x: T) {} } const g = f.<void>;',
])('specialization preserves returns and lexical shadowing: %s', (source) => expect(ok(source)).toBe(true));

test('a dependent alias is checked after specialization', () => {
  expectStaticTypeError('type V<T: type> = T; function f<T: type>(a: any) { let x: V.<T> = a; } const g = f.<void>;');
});

test('void nested inside a protocol is not a void binding', () => {
  expect(ok('function f<T: type>(x: Generator.<uint8, T, T>) {} const g = f.<void>;')).toBe(true);
});
