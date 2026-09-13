import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each(['let', 'const', 'var'])('a %s for-in annotation checks String keys', (kind) => {
  expectStaticTypeError(`function unused() { for (${kind} n: uint8 in { x: 1 }) {} }`);
  expect(evaluated(`let result = ""; for (${kind} key: string in { x: 1 }) { result = key; } result;`)).toBe('x');
});

test('a for-in target must accept keys through its declared location type', () => {
  expectStaticTypeError('function unused() { let n: uint8 = 1; for (n in { x: 1 }) {} }');
  expect(evaluated('let n: string = ""; function key(): ref string { return ref n; } for (key() in { x: 1 }) {} n;')).toBe('x');
});

test.each(['let', 'var'])('a %s loop binding retains its annotation for dynamic stores', (kind) => {
  expectThrownKind(`for (${kind} key: string in { x: 1 }) { const bad: any = {}; key = bad; }`, 'TypeError');
});

test('plain unannotated for-in bindings remain mutable and untyped', () => {
  expect(ok('for (let key in { x: 1 }) { key = 2; }')).toBe(true);
  expect(ok('for (var key in { x: 1 }) { key = 2; }')).toBe(true);
});

test('a typed for-of binding also checks a dynamic incoming value', () => {
  expectThrownKind('const values: any = ["s"]; for (let n: uint8 of values) {}', 'TypeError');
});
