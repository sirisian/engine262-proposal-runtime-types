import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-interface-declaration-identity: an interface declaration extends the
 * types its `extends` list names. It has their members, it refines each one
 * that is an interface (#sec-issubtype), and a class that implements it
 * refines them too.
 */
const A = 'interface A { a: string; } ';
const B = `${A}interface B extends A { b: uint8; } `;
const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};
const heritage = (source: string): void => refused(source, 'rt-interface-heritage');

test('a value and a class reach a base through extends, across two levels', () => {
  expect(evaluated(`${B}const v: B = { a: 'x', b: 1 }; function f(x: A) { return x.a; } f(v);`)).toBe('x');
  expect(evaluated(`${B}class C implements B { a: string = 'x'; b: uint8 = 1; } function f(x: A) { return x.a; } f(new C());`)).toBe('x');
  expect(evaluated(`${B}interface C3 extends B { c: boolean; } class K implements C3 { a: string = 'x'; b: uint8 = 1; c: boolean = true; } function f(x: A) { return x.a; } f(new K());`)).toBe('x');
  expect(evaluated(`${B}String(Reflect.isAssignable(B, A)) + String(Reflect.isAssignable(A, B));`)).toBe('truefalse');
});

test('the edge is one-way, and declaration identity is kept', () => {
  refused(`${B}class L implements A { a: string = 'x'; } function g(x: B) { return x.b; } g(new L());`, 'rt-assignability');
  refused(`${B}interface B2 extends A { b: uint8; } class M implements B2 { a: string = 'x'; b: uint8 = 1; } function g(x: B) { return x.b; } g(new M());`, 'rt-assignability');
});

test('inherited members are members', () => {
  expect(evaluated(`${B}function h(c: B) { return c.a + String(c.b); } const v: B = { a: 'x', b: 2 }; h(v);`)).toBe('x2');
  refused(`${B}class P implements B { b: uint8 = 1; }`, 'rt-implements-contract');
  expect(evaluated(`${B}function isB(v: any) { return v is B; } const w: B = { a: 'x', b: 1 }; String(isB(w)) + String(isB({ b: 1 }));`)).toBe('truefalse');
});

test('a redeclared member must satisfy the member it replaces', () => {
  const R = 'interface R { readonly n: uint8 | string; m(x: uint8): uint8 | string; w: uint8; o: uint8; } ';
  expect(observeScript(`${R}interface R1 extends R { readonly n: uint8; } 'ok';`)).toMatchObject({ completion: { Type: 'normal' } });
  expect(observeScript(`${R}interface R2 extends R { m(x: uint8 | string): uint8; } 'ok';`)).toMatchObject({ completion: { Type: 'normal' } });
  heritage(`${R}interface R3 extends R { w: uint16; }`);
  heritage(`${R}interface R4 extends R { m(x: 5): uint8; }`);
  heritage(`${R}interface R5 extends R { o?: uint8; }`);
});

test('two bases that supply one member give the one that satisfies the other', () => {
  const X = 'interface X1 { m(): uint8; } interface X2 { m(): uint8; } interface X3 { m(): string; } interface X4 { m(): uint8 | string; } ';
  expect(observeScript(`${X}interface Y1 extends X1, X2 {} 'ok';`)).toMatchObject({ completion: { Type: 'normal' } });
  expect(observeScript(`${X}interface Y4 extends X1, X4 {} interface Y5 extends X4, X1 {} 'ok';`)).toMatchObject({ completion: { Type: 'normal' } });
  heritage(`${X}interface Y2 extends X1, X3 {}`);
  expect(observeScript(`${X}interface Y3 extends X1, X3 { m(): never; } 'ok';`)).toMatchObject({ completion: { Type: 'normal' } });
});

test('a member that arrives by two paths is one member', () => {
  expect(evaluated('interface Top { v: uint8; t(): uint8 | string; } interface Left extends Top { t(): uint8; } interface Right extends Top {} interface Bottom extends Left, Right {} '
    + 'class D implements Bottom { v: uint8 = 1; t(): uint8 { return 2; } } function f(x: Top) { return x.v; } String(f(new D()));')).toBe('1');
});

test('a generic base keeps its arguments, invariantly', () => {
  const G = 'interface G<T: type> { v: T; } interface H<T: type> extends G.<T> { w: T; } class C implements H.<uint8> { v: uint8 = 1; w: uint8 = 2; } ';
  expect(evaluated(`${G}function f(g: G.<uint8>): uint8 { return g.v; } String(f(new C()));`)).toBe('1');
  refused(`${G}function f(g: G.<uint16>) { return 1; } f(new C());`, 'rt-assignability');
});

test('a callable interface is callable with its own signatures and its base\'s', () => {
  expect(observeScript("interface F1 { (string): string; } interface F2 extends F1 { (string, string): string; } function call(a: F2) { return a('a') + a('a', 'b'); } 'ok';"))
    .toMatchObject({ completion: { Type: 'normal' } });
});

test('a base may be an object type, written through an alias', () => {
  expect(evaluated("type CR = { name: string; }; interface Cls extends CR { tag: uint8; } class M implements Cls { name: string = 'm'; tag: uint8 = 1; } const m = new M(); m.name + String(m.tag);")).toBe('m1');
  heritage("type CR = { name: string; }; interface Bad extends CR { name: uint8; }");
});

test('a base may be declared later', () => {
  expect(evaluated('interface Early extends Late { e: uint8; } interface Late { l: uint8; } const v: Early = { e: 1, l: 2 }; String(v.l);')).toBe('2');
});

test('the early errors of an extends list', () => {
  heritage('interface A extends B {} interface B extends A {}');
  heritage('interface U extends V {} interface V extends W {} interface W extends U {}');
  heritage('interface Self extends Self {}');
  heritage('class K {} interface I1 extends K {}');
  heritage('interface I2 extends uint8 {}');
  heritage('enum E { a, b } interface I3 extends E {}');
  heritage(`${A}interface I5 extends A, A {}`);
  expect(observeScript(`${A}partial interface A extends A {}`)).toMatchObject({ bodyEntered: false, errorClass: 'SyntaxError' });
});
