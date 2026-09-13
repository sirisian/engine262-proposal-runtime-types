import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * WHAT A VALUE OF A VALUE TYPE REPORTS.
 *
 * #sec-decimal-types and #sec-complex-numbers make these value types, so
 * `Reflect.typeOf` must answer the type and not the shape of the object that
 * carries it. Both fell through to the shape branches and answered the literal
 * type of an object with no own properties, so every decimal - whatever its
 * width - reported the same `{}`, while `decimal32("1") is decimal64` answered
 * *false* and a `decimal32` annotation refused a `decimal64`. Two answers
 * disagreeing is what #sec-instanceof-for-type-objects exists to prevent.
 */

test('each decimal width reports its own type', () => {
  expect(evaluated('`${Reflect.typeOf(decimal32("1"))}`;')).toBe('decimal32');
  expect(evaluated('`${Reflect.typeOf(decimal64("1"))}`;')).toBe('decimal64');
  expect(evaluated('`${Reflect.typeOf(decimal128("1"))}`;')).toBe('decimal128');
  // Distinct from one another, which is the property that failed: all three
  // were `{}`, so all three compared equal.
  expect(evaluated('`${Reflect.typeOf(decimal32("1")) === Reflect.typeOf(decimal64("1"))}`;')).toBe('false');
  // And INTERNED with the written type rather than merely printing like it.
  expect(evaluated('`${Reflect.typeOf(decimal64("1")) === (type decimal64)}`;')).toBe('true');
});

test('a complex reports its component width', () => {
  // The bare name is `complex.<number>`, so a width prints through its
  // component - which is also how the written `complex128` resolves.
  expect(evaluated('`${Reflect.typeOf(complex64(1, 2))}`;')).toBe('complex.<float32>');
  expect(evaluated('`${Reflect.typeOf(complex128(1, 2))}`;')).toBe('complex.<float64>');
  expect(evaluated('`${Reflect.typeOf(complex128(1, 2)) === (type complex128)}`;')).toBe('true');
  expect(evaluated('`${Reflect.typeOf(complex64(1, 2)) === Reflect.typeOf(complex128(1, 2))}`;')).toBe('false');
});

test('an enumerator over one of these still reports its ENUM', () => {
  // The ordering constraint these arms sit under. A decimal-backed enumerator
  // IS a decimal object, so an arm keyed on the representation and placed
  // before `RegisteredEnumOf` reports `decimal64` where the program declared an
  // enum - which is what a first attempt did, and what this pins.
  expect(evaluated('enum D: decimal64 { A = 1.0 } `${Reflect.typeOf(D.A) === D}`;')).toBe('true');
  expect(evaluated('enum S: string { A = "x" } `${Reflect.typeOf(S.A) === S}`;')).toBe('true');
  expect(evaluated('enum N { Zero } `${Reflect.typeOf(N.Zero) === N}`;')).toBe('true');
});

test('the families that already reported correctly still do', () => {
  expect(evaluated('`${Reflect.typeOf(rational(1, 2))}`;')).toBe('rational');
  expect(evaluated('`${Reflect.typeOf(vector.<uint8, 4>(1,2,3,4))}`;')).toBe('vector.<uint.<8>, 4>');
  expect(evaluated('let a: uint8 = 1; `${Reflect.typeOf(a)}`;')).toBe('uint.<8>');
  expect(evaluated('let a: uint8 = 0; let b: uint8 = 5; `${Reflect.typeOf(a..<b)}`;')).toBe('ClosedOpenRange.<uint.<8>>');
});
