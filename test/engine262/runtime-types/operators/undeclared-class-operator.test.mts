import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-operator-declarations and #sec-which-operations-each-family-defines.
 *
 * "Division does not commute, so no such block exists for it and `2 / v` stays
 * a type error, which is correct, since it is not defined." A typed class is a
 * nominal type held to the operators it declares. It inherits
 * `Object.prototype`'s `valueOf` and `toString`, so the conversion judgment saw
 * a conversion that succeeds and `2 / v` answered NaN.
 */

const V = 'class V { x: float64 = 1; } ';

test('an arithmetic, bitwise or ordered operator a typed class does not declare is refused', () => {
  expectStaticTypeError(`${V} 2 / new V();`);
  expectStaticTypeError(`${V} new V() * 2;`);
  expectStaticTypeError(`${V} new V() < 2;`);
  expectStaticTypeError(`${V} new V() + 1;`);
  expectStaticTypeError(`${V} new V() | 1;`);
});

test('a declared operator, a declared conversion, concatenation and primitive blocks are admitted', () => {
  expect(evaluated(`${V} String(new V() + "s");`)).toBe('[object Object]s');
  expect(evaluated(`${V} String("id: " + new V());`)).toBe('id: [object Object]');
  expect(evaluated('class V { x: float64 = 1; operator*(r: uint8): float64 { return this.x; } } String(new V() * (2 := uint8));')).toBe('1');
  expect(evaluated('class V { x: float64 = 1; operator*(r: uint8): float64 { return this.x; } } class V2 extends V { y: uint8 = 0; } String(new V2() * (2 := uint8));')).toBe('1');
  expect(evaluated('class W { x: float64 = 1; valueOf() { return 4; } } String(new W() / 2);')).toBe('2');
  expect(evaluated(`${V} primitive number { operator*(rhs: V): string { return "p"; } } String(2 * new V());`)).toBe('p');
});

test('untyped classes and unknown left operands are unchanged', () => {
  expect(evaluated('class U { } String(new U() / 2);')).toBe('NaN');
  expect(evaluated(`${V} let a: any = 2; String(a / new V());`)).toBe('NaN');
});
