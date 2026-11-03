import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: an operator definition takes clauses as a method does,
 * over its operands, its receiver and its result, judged at the declaration
 * and checked at each application.
 */

const refused = (source: string, rule: string) => expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });

test('an operator clause is checked at each application', () => {
  expect(evaluated("class V { v: uint8 = 1; operator*(rhs: uint8): V where rhs > 10 { return this; } } const b = new V() * (20 := uint8); 'ok';")).toBe('ok');
  expect(evaluated("class V { v: uint8 = 1; operator*(rhs: uint8): V where rhs > 10 { return this; } } let m = 'none'; try { const b = new V() * (5 := uint8); m = 'ran'; } catch (e) { m = 'threw'; } m;")).toBe('threw');
  expect(evaluated('class V { v: uint8 = 1; operator*(rhs: uint8): uint8 where return > 0 { return rhs; } } String(new V() * (3 := uint8));')).toBe('3');
});

test('an operator clause is judged at the declaration', () => {
  refused("class V { v: uint8 = 1; operator*(rhs: uint8): V where rhs > 300 { return this; } } 'ok';", 'rt-numeric-range');
  refused("class V { v: uint8 = 1; operator*(rhs: uint8): V where this.v > 300 { return this; } } 'ok';", 'rt-numeric-range');
  expect(evaluated("class V { v: uint8 = 1; operator*(rhs: uint8): V where this.v > 0 { return this; } } const b = new V() * (3 := uint8); 'ok';")).toBe('ok');
});

test('a conversion or spread operator takes clauses too', () => {
  expect(evaluated('class A { x = 7; operator number() where this.x > 0 { return this.x; } } const a = new A(); let n: number = a; String(n);')).toBe('7');
  expect(evaluated("class A { x = 0; operator number() where this.x > 0 { return this.x; } } let r = 'none'; try { const a = new A(); let n: number = a; r = 'ran'; } catch (e) { r = 'threw'; } r;")).toBe('threw');
  refused("class L { n: uint8 = 2; * operator ...() where this.n > 300 { yield 1; } } 'ok';", 'rt-numeric-range');
});

test('a primitive block\'s operator reads the primitive as its receiver', () => {
  refused("primitive uint8 { operator+(rhs: string): string where this > 300 { return rhs; } } 'ok';", 'rt-numeric-range');
  expect(evaluated("primitive uint8 { operator+(rhs: string): string where this < 200 { return String(this) + rhs; } } String((7 := uint8) + 'x');")).toBe('7x');
  expect(evaluated("primitive uint8 { operator+(rhs: string): string where this < 5 { return String(this) + rhs; } } let r = 'none'; try { r = String((7 := uint8) + 'x'); } catch (e) { r = 'threw'; } r;")).toBe('threw');
});
