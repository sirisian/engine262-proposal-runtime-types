import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

// #sec-typed-classes, #sec-replacement-values: a decorator may replace a class
// only with the class or a subclass of it, so a decorated base is a bounded
// origin. The rules that hold for every subclass read it; the rest wait for an
// established origin, which a decorator returning nothing leaves in place.

const D = 'function d(c, ctx) {} ';
const VOID = 'function d(c: any, ctx: any): void {} ';

test('redeclaration and override checks read a decorated base', () => {
  expectStaticTypeError(`${D}@d class A { x: uint8; } class B extends A { x: uint8; }`);
  expectStaticTypeError(`${D}@d class A { m(): uint8 { return 1; } } class B extends A { m(): string { return ''; } }`);
  expect(evaluated(`${D}@d class A { m(): uint8 { return 1; } } class B extends A { m(): uint8 { return 2; } } 'ok';`)).toBe('ok');
});

test('a constructor signature waits for an established origin', () => {
  expectThrownKind(`${D}@d class A { constructor(x: uint8) {} } class B extends A {} new B("s");`, 'TypeError');
});

test('a decorator that returns nothing leaves the base established', () => {
  expectStaticTypeError(`${VOID}@d class A { constructor(x: uint8) {} } class B extends A {} new B("s");`);
  expectStaticTypeError(`${VOID}@d class A { m(): uint8 { return 1; } } class B extends A { m(): string { return ''; } }`);
});
