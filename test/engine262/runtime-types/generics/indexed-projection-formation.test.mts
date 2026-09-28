import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  "type V<T:type>=T[\"absent\"];function unused(x:V.<{x:uint8}>){}",
  "type V<T:type>={value:T[\"absent\"]};function unused(x:V.<{x:uint8}>){}",
  "type V<T:type>=T[\"absent\"];function unused(x:V.<T:{x:uint8}>){}",
  "type V<T:type>=T[\"absent\"];type Bad=V.<{x:uint8}>;"
])('rejects a disproved contract: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "type V<T:type>=T[\"absent\"];",
  "type V<T:type>=T[\"x\"];function unused(x:V.<{x:uint8}>):uint8{return x;}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});
