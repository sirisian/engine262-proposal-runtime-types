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

test('a base may be written in place, through an alias, or as an intersection', () => {
  expect(evaluated("interface Inline extends { a: string } { b: uint8; } const v: Inline = { a: 'x', b: 1 }; v.a;")).toBe('x');
  expect(evaluated("type CR = { name: string; }; type Both = CR & { extra: uint8 }; interface ViaBoth extends Both {} const v: ViaBoth = { name: 'n', extra: 1 }; v.name;")).toBe('n');
  expect(evaluated(`${A}type Alias = A; interface ViaAlias extends Alias { z: uint8; } class C implements ViaAlias { a: string = 'x'; z: uint8 = 1; } String(Reflect.isAssignable(C, A));`)).toBe('true');
  expect(evaluated('interface GD<T: type = uint8> { v: T; } interface H2 extends GD {} const v: H2 = { v: 1 }; String(v.v);')).toBe('1');
  expect(evaluated('function scoped() { interface Early extends Late { e: uint8; } interface Late { l: uint8; } const v: Early = { e: 1, l: 2 }; return v.l; } String(scoped());')).toBe('2');
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
  heritage('interface F1 { (string): void; } interface Handler extends F1 { once: boolean; }');
  heritage('interface G<T: type> { v: T; } interface H<T: type> extends T {}');
  refused('interface G<T: type> { v: T; } interface H1 extends G {}', 'rt-generic-argument');
  expect(observeScript(`${A}partial interface A extends A {}`)).toMatchObject({ bodyEntered: false, errorClass: 'SyntaxError' });
});

test('a class reaches a base at run time, and each activation has its own interfaces', () => {
  expect(evaluated(`${B}class C implements B { a: string = 'x'; b: uint8 = 1; } String(Reflect.isAssignable(C, B)) + String(Reflect.isAssignable(C, A));`)).toBe('truetrue');
  expect(evaluated("function make() { interface A { a: string; } interface B extends A { b: uint8; } class C implements B { a: string = 'x'; b: uint8 = 1; } return [C, A]; } "
    + 'const [C1, A1] = make(); const [C2, A2] = make(); String(Reflect.isAssignable(C1, A1)) + String(Reflect.isAssignable(C1, A2)) + String(Reflect.isAssignable(C2, A2));')).toBe('truefalsetrue');
});

/**
 * #sec-generic-where: an inherited signature keeps its `where` clauses. A
 * replacing member states no clause the replaced member's clauses do not
 * imply, and two bases' contracts combine as two implemented interfaces' do.
 */
test('an inherited signature keeps its contract', () => {
  const AW = 'interface A { m(x: uint8): void where x > 100; } interface B extends A { n(): void; } class C implements B { m(x: uint8): void {} n(): void {} } ';
  refused(`${AW}new C().m(20);`, 'rt-where-unsatisfied');
  expect(evaluated(`${AW}function g(v: uint8) { try { new C().m(v); return 'ran'; } catch (e) { return e.constructor.name; } } g(20) + '/' + g(120);`)).toBe('TypeError/ran');
});

test('a replacing member may weaken a contract and may not strengthen it', () => {
  const AW = 'interface A { m(x: uint8): void where x > 100; } ';
  expect(observeScript(`${AW}interface B1 extends A { m(x: uint8): void where x > 50; } 'ok';`)).toMatchObject({ completion: { Type: 'normal' } });
  heritage(`${AW}interface B2 extends A { m(x: uint8): void where x > 200; }`);
});

test('two bases that give one member two contracts combine them', () => {
  expect(evaluated('interface P { m(x: uint8): uint8 where x > 100; } interface Q { m(x: uint8): uint8 where x < 50; } interface PQ extends P, Q {} '
    + "class Z implements PQ { m(x: uint8): uint8 { return x; } } function g(v: uint8) { try { return String(new Z().m(v)); } catch (e) { return e.constructor.name; } } g(120) + '/' + g(20) + '/' + g(70);")).toBe('120/20/TypeError');
});

/**
 * #sec-object-types: where a base is not an object type, the structural form
 * is the intersection of that base with the record of the members.
 */
test('a base may be an array type or a tuple type', () => {
  const TSA = 'interface TSA extends [].<string | undefined> { raw: [].<string>; } ';
  expect(observeScript(`${TSA}function tag(strings: TSA) { return String(strings.raw.length) + String(strings.length) + String(strings[0]); } 'ok';`)).toMatchObject({ completion: { Type: 'normal' } });
  expect(evaluated(`${TSA}function f(v: any) { return v is TSA; } const arr: any = ['a']; arr.raw = ['a']; String(f(arr)) + String(f(['a'])) + String(f({ raw: [] }));`)).toBe('truefalsefalse');
  expect(observeScript("interface Pair extends [string, uint32] { label: string; } function f(p: Pair) { return p[0] + p.label; } 'ok';")).toMatchObject({ completion: { Type: 'normal' } });
  refused(`${TSA}class N implements TSA { raw: [].<string> = []; }`, 'rt-implements-contract');
});

/**
 * #sec-resolveoverload: a type that refines the parameter's interface is not
 * made to lose to an unrelated structural signature.
 */
test('a declared relation outranks a structural one', () => {
  const picks = "interface A { a: string; } interface Other { a: string; } function pick(x: A): string { return 'A'; } function pick(x: Other): string { return 'Other'; } ";
  expect(evaluated(`${picks}class C implements A { a: string = 'x'; } pick(new C());`)).toBe('A');
  expect(evaluated(`${picks}interface B extends A { b: uint8; } class D implements B { a: string = 'x'; b: uint8 = 1; } pick(new D());`)).toBe('A');
  expect(evaluated(`${picks}class E implements Other { a: string = 'x'; } pick(new E());`)).toBe('Other');
});

test('a contribution to a base reaches the interfaces that extend it', () => {
  const parts = `${B}partial interface A { c: uint8; } `;
  expect(evaluated(`${parts}const v: B = { a: 'x', b: 1, c: 2 }; String(v.c);`)).toBe('2');
  refused(`${parts}const v: B = { a: 'x', b: 1 };`, 'rt-required-member');
});

test('a reference back to the interface through a base is a recursive edge', () => {
  expect(observeScript("interface Container<T: type> { items: [].<T>; } interface Node extends Container.<Node> { label: string; } function f(n: Node) { return n.items.length; } 'ok';"))
    .toMatchObject({ completion: { Type: 'normal' } });
  expect(observeScript("interface A { b: B; } interface B extends A { n: uint8; } function f(x: B) { return x.b.n; } 'ok';")).toMatchObject({ completion: { Type: 'normal' } });
});

/**
 * #table-reflection-nodes: the node of an interface type carries `extends`,
 * the types its declaration extends, in the order written; the reflection of
 * a class carries `implements`.
 */
test('reflection reports what an interface extends and what a class implements', () => {
  const C = `${B}class C implements B { a: string = 'x'; b: uint8 = 1; } `;
  expect(evaluated(`${C}const n = Reflect.getReflection.<Reflect.Type>(B); n.kind + '/' + String(n.extends.length) + '/' + String(n.extends[0] === A);`)).toBe('primitive/1/true');
  expect(evaluated(`${C}const n = Reflect.getReflection.<Reflect.Type>(A); String(Array.isArray(n.extends)) + '/' + String(n.extends.length);`)).toBe('true/0');
  expect(evaluated(`${C}const n = Reflect.getReflection.<Reflect.Type>(uint8); String(n.extends) + '/' + String('extends' in n);`)).toBe('undefined/false');
  expect(evaluated(`${C}const r = Reflect.getReflection.<Reflect.Class, C>(); String(r.implements.length) + '/' + String(r.implements[0] === B);`)).toBe('1/true');
  expect(evaluated('class K {} String(Reflect.getReflection.<Reflect.Class, K>().implements.length);')).toBe('0');
});

test('reflection reports a generic base at its arguments and every kind of base in order', () => {
  expect(evaluated('interface G<T: type> { v: T; } interface H<T: type> extends G.<T> { w: T; } const n = Reflect.getReflection.<Reflect.Type>(H.<uint8>); String(n.extends.length) + \'/\' + String(n.extends[0] === G.<uint8>);')).toBe('1/true');
  expect(evaluated("type CR = { name: string; }; interface X1 { m(): uint8; } interface Cls extends CR, X1 { tag: uint8; } const n = Reflect.getReflection.<Reflect.Type>(Cls); String(n.extends[0] === CR) + '/' + String(n.extends[1] === X1);")).toBe('true/true');
});

/**
 * #sec-iteration-types: the iteration protocols relate as interface
 * declarations with `extends` do, and a declared interface may extend them.
 */
test('an interface may extend the built-in iteration protocols', () => {
  expect(observeScript("interface Counted<T: type> extends Iterable.<T> { count: uint8; } function f(c: Counted.<uint8>): Iterable.<uint8> { return c; } 'ok';")).toMatchObject({ completion: { Type: 'normal' } });
  expect(observeScript('interface Mine<T: type> extends Iterable.<T>, Iterator.<T> {} function f(m: Mine.<uint8>): Iterable.<uint8> { return m; } '
    + "function g(m: Mine.<uint8>): Iterator.<uint8> { return m; } 'ok';")).toMatchObject({ completion: { Type: 'normal' } });
  expect(evaluated('function f(x: Iterable.<uint8>) { return 1; } const it: IterableIterator.<uint8> = [1, 2].values(); String(f(it));')).toBe('1');
});
