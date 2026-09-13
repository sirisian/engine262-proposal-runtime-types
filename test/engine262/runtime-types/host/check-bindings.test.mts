import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  'function f(...xs: [].<uint8>) { let s: string = xs[0]; }',
  'function f([x: uint8]) { let s: string = x; }',
  'function f([x: uint8 = "s"]) {}',
  'function f() { let [x: uint8] = ["s"]; }',
  'function f() { let [x: uint8 = "s"] = []; }',
  'function f() { let x: uint8 = 1; [x] = ["s"]; }',
  'function f() { let { a: x: uint8 } = { a: "s" }; }',
  'function f() { let x: uint8 = 1; ({ a: x } = { a: "s" }); }',
  'function f() { let x: string = ""; let a: [].<uint8> = [1]; for (x of a) {} }',
  'function f() { let a: [].<uint8> = [1]; for (const [x: uint8] of [a]) { let s: string = x; } }',
  'function f() { { var x: uint8 = 1; } x = "s"; }',
  'function f() { x = "s"; { var x: uint8 = 1; } }',
])('rejects a known binding boundary before execution: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  'let xs: uint8 = 1; function f(...xs) { xs = "s"; }',
  'let x: uint8 = 1; function f([x]) { x = "s"; }',
  'let x: uint8 = 1; function f({ x }) { x = "s"; }',
  'let x: uint8 = 1; function f() { try {} catch (x) { x = "s"; } }',
  'function f() { let i: string = ""; for (let i: uint8 = 0; i < 1; i++) {} i = "ok"; }',
  'function f() { let [x: uint8, y: string = "s"] = [1]; let n: uint8 = x; }',
  'function f() { let x: uint8 = 1; [x] = [2]; }',
  'function f() { let x: uint8 = 1; let a: [].<uint8> = [1]; for (x of a) {} }',
])('preserves valid binding scope and conversion: %s', (source) => {
  expect(ok(source)).toBe(true);
});
