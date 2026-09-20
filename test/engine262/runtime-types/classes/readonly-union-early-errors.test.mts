import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

const classes = 'class A { readonly x: uint8 = 1; } class B { readonly x: uint8 = 2; }';

test.each(['o.x = 3', 'o["x"] = 3', 'o.x += 1', 'o.x++', '++o.x',
  '[o.x] = [3]', '({ x: o.x } = { x: 3 })', 'for (o.x of [3]) {}', 'for (o.x in {}) {}',
])('a union write requires permission from each alternative: %s', (statement) => {
  expectStaticTypeError(`${classes} function unused(o: A | B) { ${statement}; }`);
});

test('one readonly alternative suffices, including structural and interface views', () => {
  expectStaticTypeError('class A { readonly x: uint8 = 1; } class B { x: uint8 = 2; } function unused(o: A | B) { o.x = 3; }');
  expectStaticTypeError('function unused(o: { readonly x: uint8, a: string } | { x: uint8, b: string }) { o.x = 1; }');
  expectStaticTypeError('interface A { readonly x: uint8; a: string } interface B { x: uint8; b: string } function unused(o: A | B) { o.x++; }');
  expectStaticTypeError('class Base<T> { readonly x: T; } class A extends Base.<uint8> {} class B { x: uint8; } function unused(o: A | B) { o.x = 3; }');
});

test('symbol-keyed union writes enforce readonly too', () => {
  expectStaticTypeError('function unused(o: { readonly [Symbol.dispose]: uint8, a: string } | { [Symbol.dispose]: uint8, b: string }) { o[Symbol.dispose] = 1; }');
});

test('narrowing and declaring-constructor writes remain valid', () => {
  expect(evaluated('class A { readonly x: uint8 = 1; } class B { x: uint8 = 2; } function f(o: A | B) { if (o instanceof B) { o.x = 3; } return String(o.x); } f(new B());')).toBe('3');
  expect(evaluated('class A { readonly x: uint8; constructor() { this.x = 1; } } String(new A().x);')).toBe('1');
  expectStaticTypeError('class A { readonly x: uint8; constructor() { const f = () => { this.x = 1; }; } }');
});

test('writable unions, shallow readonly, and unknown receivers retain their contracts', () => {
  expect(ok('class A { x: uint8; } class B { x: uint8; } function f(o: A | B) { o.x++; } f(new A());')).toBe(true);
  expect(ok('function f(o: { readonly x: { y: uint8 }, a: string } | { readonly x: { y: uint8 }, b: string }) { o.x.y = 2; }')).toBe(true);
  expectThrownKind(`${classes} function f(o: any) { o.x = 3; } f(new A());`, 'TypeError');
});
