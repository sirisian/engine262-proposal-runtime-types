import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-issubtype: callable values satisfy an object contract with no members.
test('a function satisfies an empty object contract without losing its identity', () => {
  expect(evaluated('const f = (x: uint8): uint8 => x; const o: {} = f; '
    + 'String(o === f) + "/" + String(Reflect.typeOf(o) === Reflect.typeOf(f));')).toBe('true/true');
  expect(evaluated('type F = (x: uint8) => uint8; '
    + 'String(Reflect.isAssignable(F, type {})) + "/" + String(F === type {});')).toBe('true/false');
});

test('an empty object contract does not establish callability or named members', () => {
  expectStaticTypeError('function invoke(f: {}) { return f(); }');
  expect(evaluated('function invoke(f: any) { return f(); } String(invoke(() => 3));')).toBe('3');
  expectStaticTypeError('const f = (): void => {}; const o: { required: uint8 } = f;');
  expectStaticTypeError('const f = (): void => {}; const o: { [key: string]: uint8 } = f;');
  expectStaticTypeError('const o: {} = 1;');
});

test('empty interfaces use the same structural relation for callables', () => {
  expect(evaluated('interface Empty {} const f: Empty = (): void => {}; typeof f;')).toBe('function');
});
