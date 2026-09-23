import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  'function f(x: uint8) { return x; } function f(x: uint8) { return "s"; }',
  'function f(x: uint8): void {} function f(x: uint8, y: string = "s"): void {}',
  'function f(x: uint8): void {} function f(x: uint8, y?: string): void {}',
  'class C { m(x: uint8): void {} m(x: uint8): void {} }',
  'class C { static m(x: uint8): void {} static m(x: uint8): void {} }',
  'class C { m<T: type>(x: T): T { return x; } m<U: type>(x: U): U { return x; } }',
  'class C { m(x: uint8): void {} m(x: uint8, y: string = "s"): void {} }',
  'const c = { m(x: uint8): void {}, m(x: uint8): void {} };',
  'const c = { m<T: type>(x: T): T { return x; }, m<U: type>(x: U): U { return x; } };',
  'const c = { *m(x: uint8): uint8 { yield x; }, *m(x: uint8): uint8 { yield x; } };',
  'const c = { async m(x: uint8): Promise.<uint8> { return x; }, async m(x: uint8): Promise.<uint8> { return x; } };',
])('overlapping declared signatures reject without a call: %s', (source) => {
  expectStaticTypeError(source);
  expectStaticTypeError(`function unused() { ${source} }`);
});

test('declared returns, constraints, and legacy overrides remain distinct', () => {
  expect(evaluated('class C { m(x: uint8): uint8 { return x; } m(x: uint8): string { return "s"; } } const n: uint8 = new C().m(1); String(n);')).toBe('1');
  expect(ok('class C { m<T: type extends string>(x: T): T { return x; } m<U: type extends uint8>(x: U): U { return x; } }')).toBe(true);
  expect(evaluated('class C { m() { return 1; } m() { return 2; } } String(new C().m());')).toBe('2');
  expect(evaluated('const c = { m() { return 1; }, m() { return 2; } }; String(c.m());')).toBe('2');
  expect(ok('class B { m(x: uint8): uint8 { return x; } } class C extends B { m(x: uint8): uint8 { return x; } }')).toBe(true);
});

test.each([false, true])('fixed positions break a rest tie independently of declaration order: %s', (reverse) => {
  const fixed = 'function f(x: float32, ...tail: [].<float32>): string { return "fixed"; }';
  const rest = 'function f(...xs: [].<float32>): string { return "rest"; }';
  const declarations = reverse ? rest + fixed : fixed + rest;
  expect(evaluated(`${declarations} let x: float32 = 1; f(x, x);`)).toBe('fixed');
});

test('literal ranking precedes fixed-position specificity', () => {
  expect(evaluated('function f(x: uint8): string { return "fixed"; } function f(...xs: [].<float32>): string { return "rest"; } f(1);')).toBe('rest');
});
