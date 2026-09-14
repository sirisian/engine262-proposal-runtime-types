import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

test('array pattern positions follow iteration instead of mutable indexed storage', () => {
  expect(evaluated('let a: [string] = ["stored"]; a[Symbol.iterator] = function*() { yield uint8(1); }; String(match(a) { when [let x]: { let n: uint8 = x; n; } default: 0; });')).toBe('1');
  expectThrownKind('let a: [uint8] = [1]; a[Symbol.iterator] = function*() { yield "text"; }; match(a) { when [let x]: { let n: uint8 = x; n; } default: 0; };', 'TypeError');
});

test('explicit pattern annotations still test unknown iterator values', () => {
  expect(evaluated('let a: [uint8] = [1]; a[Symbol.iterator] = function*() { yield "text"; }; String(match(a) { when [let x: uint8]: x; default: 0; });')).toBe('0');
});

test('typed immutable Composite positions remain known', () => {
  expect(evaluated('const a = Composite.<[uint8]>([1]); String(match(a) { when [let x]: { let n: uint8 = x; n; } default: 0; });')).toBe('1');
  expectStaticTypeError('const a = Composite.<[uint8]>([1]); match(a) { when [let x]: { let n: [uint8] = x; n; } default: [0]; };');
});

test('a declared iterator protocol supplies its yielded element type', () => {
  expectStaticTypeError('interface Items { [Symbol.iterator]: () => Generator.<uint8, void, any>; } function f(items: Items) { return match(items) { when [let x]: { let n: [uint8] = x; n; } default: [0]; }; }');
});

test('matching preserves the chosen iterator and its effects', () => {
  expect(evaluated('let calls = 0; let a: [string] = ["stored"]; a[Symbol.iterator] = function*() { calls++; yield uint8(1); }; const result = match(a) { when [let x]: String(x); default: "none"; }; result + ":" + calls;')).toBe('1:1');
});
