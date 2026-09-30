import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-computed-constraints: infer a tuple and check its contributed elements.
test('an inferred collected tuple admits zero or more fitting values', () => {
  const collect = 'function collect<P: type extends [].<string>>(...parts: P): string { return String(parts.length); } ';
  expect(evaluated(collect + 'collect();')).toBe('0');
  expect(evaluated(collect + 'collect("a", "b", "c");')).toBe('3');
  expectStaticTypeError(collect + 'collect("a", 1);');
});

test('a collected tuple respects a stated constraint extent', () => {
  const collect = 'function collect<P: type extends [2].<string>>(...parts: P): string { return String(parts.length); } ';
  expect(evaluated(collect + 'collect("a", "b");')).toBe('2');
  expectStaticTypeError(collect + 'collect();');
  expectStaticTypeError(collect + 'collect("a");');
  expectStaticTypeError(collect + 'collect("a", "b", "c");');
});

test('a computed value domain remains distinct from a computed type bound', () => {
  const prefix = 'function baseOf(T) { return T; } ';
  expect(evaluated(prefix + 'function f<T: type, V: baseOf(T)>(): string { return String(V); } f.<uint32, 7>();')).toBe('7');
  expect(evaluated(prefix + 'function f<T: type, U: type extends baseOf(T)>(x: T, y: U): U { return y; } String(f((1 := uint32), (2 := uint32)));')).toBe('2');
});
