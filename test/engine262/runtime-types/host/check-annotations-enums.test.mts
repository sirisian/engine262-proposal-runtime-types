import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  'function f(x: Missing) {}',
  'function f(x: int.<0>) {}',
  'function f(): Missing { throw 0; }',
  'class C { x: int.<0>; }',
  'function f() { let values: [1 + 1].<uint8> = [1, 2]; values[0] = "s"; }',
  'const N = 2; function f(x: [N].<uint8>) { x[0] = "s"; }',
  'function f(x: [-1].<uint8>) {}',
  'function builder(): type { return type uint8; } function f(x: builder()) { x = "s"; }',
  'function builder() { return 1; } function f(x: builder()) {}',
  'enum E: uint8 { A = "s" }',
  'function f() { enum E: uint8 { A = "s" } }',
  'enum E: uint8 { A = (i, name): string => "s" }',
  'enum E: uint8 { A = (i, name) => { let x: uint8 = "s"; return 1; } }',
])('discharges a closed annotation or enum obligation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  'function f(x: uint8) {}',
  'function f<T: type>(x: T): T { return x; }',
  'const N = 2; function f(x: [N].<uint8>) { x[0] = 1; }',
  'function f() { let values: [1 + 1].<uint8> = [1, 2]; values[0] = 1; }',
  'function builder(): type { return type uint8; } function f(x: builder()) { x = 1; }',
  'enum E: uint8 { A = 1, B }',
  'enum E: uint8 { A = (i, name) => 1, B }',
])('preserves a valid annotation or enum: %s', (source) => {
  expect(ok(source)).toBe(true);
});
