import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// A known symbol property has the same declared read contract as a named one.
test.each([
  'function unused(o: { [Symbol.dispose]: uint8 }) { o[Symbol.dispose](); }',
  'function unused(o: { [Symbol.dispose]: uint8 }) { let s: string = o[Symbol.dispose]; }',
  'function unused(o: { [Symbol.dispose]: (x: uint8) => void }) { o[Symbol.dispose]("bad"); }',
  'function unused(o: { [Symbol.dispose]: uint8 } | null) { o?.[Symbol.dispose](); }',
  'class C { [Symbol.dispose]: uint8 = 1; } function unused(c: C) { c[Symbol.dispose](); }',
  'class B<T: type> { [Symbol.dispose]: T; } class C extends B.<uint8> {} function unused(c: C) { c[Symbol.dispose](); }',
  'interface I { [Symbol.dispose]: uint8 } function unused(o: I) { o[Symbol.dispose](); }',
  'const K = Symbol(); type T = { [K]: uint8 }; function unused(o: T) { o[K](); }',
  'const K = Symbol.dispose; function unused(o: { [Symbol.dispose]: uint8 }) { o[K](); }',
])('retains a declared symbol member: %s', expectStaticTypeError);

test('optional symbol members and union arms retain undefined', () => {
  expectStaticTypeError('function unused(o: { [Symbol.dispose]?: uint8 }) { let n: uint8 = o[Symbol.dispose]; }');
  expectStaticTypeError('function unused(o: { [Symbol.dispose]?: uint8, a: string } | { [Symbol.dispose]: uint8, b: string }) { let n: uint8 = o[Symbol.dispose]; }');
  // The shared read helper must retain optionality for named members too.
  expectStaticTypeError('function unused(o: { x?: uint8, a: string } | { x: uint8, b: string }) { let n: uint8 = o.x; }');
});

test('union symbol reads require a declaration on each alternative', () => {
  expectStaticTypeError('function unused(o: { [Symbol.dispose]: uint8 } | { x: string }) { o[Symbol.dispose]; }');
  expectStaticTypeError('function unused(o: { [Symbol.dispose]: uint8 } | { [Symbol.dispose]: string }) { let n: uint8 = o[Symbol.dispose]; }');
  expect(ok('function unused(o: { [Symbol.dispose]: uint8 } | { [Symbol.dispose]: string }) { let n: uint8 | string = o[Symbol.dispose]; }')).toBe(true);
});

test('valid methods and inherited specialized reads execute', () => {
  expect(evaluated('class C { [Symbol.dispose](x: uint8): uint8 { return x; } } String(new C()[Symbol.dispose](1));')).toBe('1');
  expect(evaluated('class B<T: type> { [Symbol.dispose]: T; } class C extends B.<uint8> {} let c: C = new C(); let n: uint8 = c[Symbol.dispose]; String(n);')).toBe('0');
});

test('unknown symbol identities and shadowed names retain dynamic lookup', () => {
  expect(ok('const K = Symbol(); type T = { [K]: uint8 }; function unused(o: T, K: any) { o[K](); }')).toBe(true);
  expect(ok('const K = Symbol(); type T = { [K]: uint8 }; function unused(o: T) { { let K: any = "m"; o[K](); } }')).toBe(true);
  expect(ok('function unused(o: { [Symbol.dispose]: uint8 }, Symbol: any) { o[Symbol.dispose](); }')).toBe(true);
  expect(ok('function unused(o: any, k: symbol) { o[k](); }')).toBe(true);
  expectThrownKind('function call(o: any) { o[Symbol.dispose](); } call({ [Symbol.dispose]: 1 });', 'TypeError');
});

test('an array symbol is still not an element, and undeclared keys stay dynamic', () => {
  expect(ok('let a: [].<uint8> = [1]; a[Symbol.iterator]();')).toBe(true);
  expect(ok('function unused(a: [].<uint8>) { let s: string = a[Symbol.iterator]; }')).toBe(true);
  expect(ok('function unused(o: { a: uint8 } | { b: uint8 }) { o[Symbol.dispose](); }')).toBe(true);
});
