import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * 64-BIT AND WIDER KEYS.
 *
 * A `uint64`, `int64` or `uint128` key compares at ITS OWN precision. This has a
 * file of its own because it is the case an implementation gets wrong by
 * accident: hash a key by converting it to a Number and two magnitudes above
 * 2**53 collapse into one bucket, so a table silently loses entries. Nothing
 * about the collection is obviously wrong when it happens - the count is just
 * smaller than the program expects.
 *
 * 9007199254740992 is 2**53, and 9007199254740993 is the first integer a double
 * cannot represent: both round to the same Number, so a Number-keyed table holds
 * one entry where a `uint64`-keyed table must hold two.
 *
 * This is the key-position form of the hazard `sec-ordered-element-types`
 * describes for element storage, and it is the reason `size` reads at the index
 * type rather than at a Number.
 */

const TWO53 = '9007199254740992n';
const TWO53_PLUS_1 = '9007199254740993n';

test('two magnitudes a double cannot distinguish are two keys', () => {
  for (const t of ['uint64', 'int64', 'uint128', 'int128']) {
    expect(evaluated(`const s = new Set.<${t}>(); s.add(${TWO53} := ${t}); s.add(${TWO53_PLUS_1} := ${t}); String(s.size);`), t).toBe('2');
  }
  // The control that makes the assertion meaningful: converted to Number, they
  // ARE the same, so a table that collapsed them would look correct until
  // counted.
  expect(evaluated(`String(Number(${TWO53}) === Number(${TWO53_PLUS_1}));`)).toBe('true');
});

test('a wide key is found by its own value, not by a rounded one', () => {
  const m = `const m = new Map.<uint64, string>(); m.set(${TWO53_PLUS_1} := uint64, "exact"); `;
  expect(evaluated(`${m} String(m.get(${TWO53_PLUS_1} := uint64));`)).toBe('exact');
  // The neighbouring magnitude is a different key and finds nothing, which is
  // what a collapsing hash would get wrong.
  expect(evaluated(`${m} String(m.get(${TWO53} := uint64));`)).toBe('undefined');
  expect(evaluated(`${m} String(m.has(${TWO53} := uint64));`)).toBe('false');
});

test('deleting one wide key leaves its neighbour', () => {
  // The failure mode a collapsed hash produces: deleting one entry takes the
  // other with it.
  const setup = `const m = new Map.<uint64, string>(); m.set(${TWO53} := uint64, "a"); m.set(${TWO53_PLUS_1} := uint64, "b"); `;
  expect(evaluated(`${setup} String(m.size);`)).toBe('2');
  expect(evaluated(`${setup} m.delete(${TWO53} := uint64); String(m.size) + "/" + String(m.get(${TWO53_PLUS_1} := uint64));`)).toBe('1/b');
});

test('the full width of the type is usable as a key', () => {
  // A key at the top of the range is a key like any other; nothing clamps.
  expect(evaluated('const s = new Set.<uint64>(); s.add(18446744073709551615n := uint64); String(s.size);')).toBe('1');
  expect(evaluated('const s = new Set.<uint64>(); s.add(18446744073709551615n := uint64); String(s.has(18446744073709551615n := uint64));')).toBe('true');
  expect(evaluated('const s = new Set.<int64>(); s.add(-9223372036854775808n := int64); s.add(9223372036854775807n := int64); String(s.size);')).toBe('2');
  // And one past the end is refused rather than wrapped.
  expect(ok('const s = new Set.<uint64>(); s.add(18446744073709551616n := uint64);')).toBe(false);
});

test('a numeric key converts where the target represents it EXACTLY, and not otherwise', () => {
  // A key position checks rather than converts only for the string target; the
  // numeric targets already had the property that rule wanted, because
  // `sec-requiretype` admits a numeric source only where the target represents
  // it exactly. So an `int64` 1 reaching a `uint64` key is admitted - it is the
  // same magnitude, and no two distinct sources can land on one key that way.
  expect(ok('const m = new Map.<uint64, string>(); const v = ((1n := int64) := any); m.set(v, "x");')).toBe(true);
  expect(evaluated('const m = new Map.<uint64, string>(); const v = ((1n := int64) := any); m.set(v, "x"); String(m.get(1n := uint64));')).toBe('x');
  // A magnitude the target CANNOT represent is refused rather than wrapped,
  // which is the half that keeps two keys from merging.
  expect(ok('const m = new Map.<uint64, string>(); const bad = ((-1n := int64) := any); m.set(bad, "x");')).toBe(false);
  expect(ok('const m = new Map.<uint8, string>(); const bad = ((300n := int64) := any); m.set(bad, "x");')).toBe(false);
});

test('size counts wide keys at the index type', () => {
  // The two halves meet here: a collection holding keys a Number cannot
  // distinguish reports a count that is itself of the index type.
  const setup = `const m = new Map.<uint64, string>(); m.set(${TWO53} := uint64, "a"); m.set(${TWO53_PLUS_1} := uint64, "b"); `;
  expect(evaluated(`${setup} String(Reflect.typeOf(m.size) === (type uint64));`)).toBe('true');
  expect(evaluated(`${setup} const n: uint64 = (2 := uint64); String(m.size === n);`)).toBe('true');
});
