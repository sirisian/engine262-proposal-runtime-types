import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// Getter presence gives a read contract; only setter presence permits a store.
test.each([
  'class C { get x(): uint8 { return 1; } bad() { this.x = 2; } }',
  'class C { get x(): uint8 { return 1; } } function unused(c: C) { c.x++; }',
  'class C { get x(): uint8 { return 1; } } function unused(c: C) { c.x += 2; }',
  'class C { get x(): uint8 { return 1; } } function unused(c: C) { [c.x] = [uint8(2)]; }',
  'class C { get x(): uint8 { return 1; } } function unused(c: C) { for (c.x of [uint8(2)]) {} }',
  'class C { static get x(): uint8 { return 1; } } function unused() { C.x = 2; }',
  'class B { get x(): uint8 { return 1; } } class C extends B {} function unused(c: C) { c.x = 2; }',
  'class C { get #x(): uint8 { return 1; } bad() { this.#x = 2; } }',
  'class B { get x(): uint8 { return 1; } } class C extends B { bad() { super.x = 2; } }',
  'class C { get x(): uint8 { return 1; } constructor() { this.x = 2; } }',
  'class C { get [Symbol.dispose](): uint8 { return 1; } } function unused(c: C) { c[Symbol.dispose] = 2; }',
  'class C<T: type> { get x(): T { throw 0; } } function unused(c: C.<uint8>) { c.x = 2; }',
  'class B { get x(): uint8 { return 1; } set x(v: uint8) {} } class C extends B { get x(): uint8 { return 1; } } function unused(c: C) { c.x = 2; }',
  'class C { get x() { return uint8(1); } } function unused(c: C) { (c.x) = 2; }',
])('rejects a known getter-only store before evaluation: %s', expectStaticTypeError);

test.each([
  'get x(): uint8 { return 1; } set x(v: uint8) {}',
  'set x(v: uint8) {} get x(): uint8 { return 1; }',
  'get x(): uint8 { return 1; } set x(v) {}',
  'set x(v) {} get x(): uint8 { return 1; }',
  'accessor x: uint8 = 1;',
])('preserves a setter independently of annotation or order: %s', (members) => {
  expect(ok(`class C { ${members} } let c: C = new C(); c.x = 2;`)).toBe(true);
});

test('getter reads work, and an unknown base keeps runtime checks', () => {
  expect(evaluated('class C { get x(): uint8 { return 1; } } String(new C().x);')).toBe('1');
  expect(ok('class H { static store(c: any) { c.x = 2; } } H.store({ x: 1 });')).toBe(true);
  expectThrownKind('class C { get x(): uint8 { return 1; } } class H { static store(c: any) { c.x = 2; } } H.store(new C());', 'TypeError');
});


test.each([
  'class C { static x: uint8 = 0; get x(): uint8 { return 1; } constructor() { this.x = 2; } }',
  'class C { #x: uint8 = 0; get x(): uint8 { return 1; } constructor() { this.x = 2; } }',
  'class C { x: uint8 = 0; get #x(): uint8 { return 1; } constructor() { this.#x = 2; } }',
])('constructor permission requires the same instance field: %s', expectStaticTypeError);

test.each([
  'get x(): uint8 { return 1; } x: uint8 = 2;',
  'get x(): uint8 { return 1; } x;',
  'x: uint8 = 2; get x(): uint8 { return 1; }',
  'get x(): uint8 { return 1; } set x(v: string) {} x: uint8 = 2;',
])('an own field shadows a prototype accessor: %s', (members) => {
  expect(evaluated(`class C { ${members} } function use(c: C): uint8 { c.x = 3; return c.x; } String(use(new C()));`)).toBe('3');
});
