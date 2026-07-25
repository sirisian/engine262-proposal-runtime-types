import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// #table-check-sites is a NORMATIVE ENUMERATION of the seven boundaries at
// which RequireType runs, and until this file nothing in the suite walked it.
// Two of its rows had never been implemented and the suite stayed green for
// forty cycles (F49): a class field store and an array element store performed
// no check at all, so `c.x = "str"` on a `x: uint8` field stored the string and
// a `[].<uint8>` degraded to plain Numbers as it was written to. The corruption
// then surfaced at an INNOCENT boundary, blaming a value the type system itself
// had admitted.
//
// So the cases here ARE the table's rows, named after them, each asserting that
// the check fires and which error kind it produces. A row that goes
// unimplemented fails a test named after that row. This is F13's kind-assertion
// audit applied to a second table.
//
// The error kinds follow #sec-requiretype: a value of a numeric type that the
// target cannot represent exactly is a RangeError (the conversion would wrap,
// truncate, or round), and a value with no conversion to the target at all is a
// TypeError. The same operation runs at every row, which is the property this
// file exists to keep true.

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function thrownKind(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'throw' });
  const message = ((completion as { Value?: { HostDefinedMessageString?: string } }).Value?.HostDefinedMessageString) ?? '';
  return message.split(':')[0];
}

// -- Row 1: the initializer or assigned value of a binding --------------------

test('row 1: a binding with a declared type', () => {
  expect(evaluated('function anyv() { return 7; } let x: uint8 = anyv(); String(x is uint8);')).toBe('true');
  expect(thrownKind('function anyv() { return 300; } let x: uint8 = anyv();')).toBe('RangeError');
  expect(thrownKind('function anyv() { return "s"; } let x: uint8 = anyv();')).toBe('TypeError');
});

// -- Row 2: an argument passed to a parameter ---------------------------------

test('row 2: an argument passed to a typed parameter', () => {
  expect(evaluated('function f(v: uint8) { return v; } function anyv() { return 7; } String(f(anyv()) is uint8);')).toBe('true');
  expect(thrownKind('function f(v: uint8) { return v; } function anyv() { return 300; } f(anyv());')).toBe('RangeError');
  expect(thrownKind('function f(v: uint8) { return v; } function anyv() { return "s"; } f(anyv());')).toBe('TypeError');
});

// -- Row 3: the operand of a `return` -----------------------------------------

test('row 3: the operand of a return in a function with a declared return type', () => {
  expect(evaluated('function anyv() { return 7; } function g(): uint8 { return anyv(); } String(g() is uint8);')).toBe('true');
  expect(thrownKind('function anyv() { return 300; } function g(): uint8 { return anyv(); } g();')).toBe('RangeError');
  expect(thrownKind('function anyv() { return "s"; } function g(): uint8 { return anyv(); } g();')).toBe('TypeError');
});

// -- Row 4: a value stored to a property or field -----------------------------

test('row 4a: a store to a declared class field', () => {
  // Unimplemented until F51: the declared type was recorded only by the
  // reflection route, so `c.x = "str"` stored the string.
  expect(evaluated('class C { x: uint8 = 1; } const c = new C(); c.x = 7; String(c.x) + "/" + String(c.x is uint8);')).toBe('7/true');
  expect(thrownKind('class C { x: uint8 = 1; } const c = new C(); c.x = 300;')).toBe('RangeError');
  expect(thrownKind('class C { x: uint8 = 1; } const c = new C(); c.x = "str";')).toBe('TypeError');
});

test('row 4b: a store to a PRIVATE declared field, which stores elsewhere', () => {
  expect(evaluated('class C { #p: uint8 = 1; set(v) { this.#p = v; return this.#p; } } String(new C().set(7) is uint8);')).toBe('true');
  expect(thrownKind('class C { #p: uint8 = 1; set(v) { this.#p = v; } } new C().set(300);')).toBe('RangeError');
  expect(thrownKind('class C { #p: uint8 = 1; set(v) { this.#p = v; } } new C().set("str");')).toBe('TypeError');
});

test('row 4c: a store to a property typed through a descriptor', () => {
  const typed = 'const o = {}; Reflect.defineProperty(o, "x", { value: (1 := uint8), type: uint8, writable: true, enumerable: true, configurable: true }); ';
  // This route was the one implemented, but it REFUSED an in-range plain
  // number rather than converting it, because the operation behind it was a
  // membership test rather than #sec-requiretype (F51).
  expect(evaluated(`${typed} o.x = 7; String(o.x) + "/" + String(o.x is uint8);`)).toBe('7/true');
  expect(thrownKind(`${typed} o.x = 300;`)).toBe('RangeError');
  expect(thrownKind(`${typed} o.x = "str";`)).toBe('TypeError');
});

test('row 4d: an untyped property is untouched by any of this', () => {
  expect(evaluated('class C { y = 1; } const c = new C(); c.y = "anything"; String(c.y);')).toBe('anything');
  expect(evaluated('const o = { z: 1 }; o.z = "anything"; String(o.z);')).toBe('anything');
});

// -- Row 5: a value stored to an element of a typed array ---------------------

test('row 5: a store to an element of an array of element type t', () => {
  const a = 'let a: [].<uint8> = [1, 2, 3]; ';
  // Unimplemented until F51: the elements were converted once at the boundary
  // and every later store went unchecked, so the array degraded to plain
  // Numbers even on a store that fit.
  expect(evaluated(`${a} a[0] = 7; String(a[0]) + "/" + String(a[0] is uint8);`)).toBe('7/true');
  expect(thrownKind(`${a} a[0] = 300;`)).toBe('RangeError');
  expect(thrownKind(`${a} a[0] = "nope";`)).toBe('TypeError');
  // Growing the array is a store like any other.
  expect(evaluated(`${a} a[3] = 4; String(a[3] is uint8) + "/" + String(a.length);`)).toBe('true/4');
  // A library push reaches the same [[Set]], so it is checked too.
  expect(thrownKind(`${a} a.push("x");`)).toBe('TypeError');
  // Neither `length` nor a non-index property is an element store.
  expect(evaluated(`${a} a.length = 2; String(a.length);`)).toBe('2');
  expect(evaluated(`${a} a.custom = "x"; String(a.custom);`)).toBe('x');
  // An untyped array is untouched.
  expect(evaluated('const b = [1]; b[0] = "x"; String(b[0]);')).toBe('x');
});

// -- Row 6: an `any` value read into an operator whose operands are typed -----

test('row 6: a value of the any type reaching a typed operator - UNIMPLEMENTED, pinned', () => {
  // The THIRD unimplemented row, found by writing this file (F51). The table
  // says an `any` value read into an operator whose operands are typed is
  // RequireType'd to the operand type, so both of these should throw: the
  // string has no conversion to uint8, and 300 is not representable in one.
  // Neither does. The current answers are pinned here so that implementing the
  // row FAILS this test and its author updates it deliberately.
  expect(evaluated('function anyv() { return "s"; } const t = (1 := uint8); String(t + anyv());')).toBe('1s');
  expect(evaluated('function anyv() { return 300; } const t = (1 := uint8); String(t + anyv());')).toBe('45');
  // What the row should produce, kept here as the expectation to switch to:
  //   thrownKind(... "s" ...) === 'TypeError'
  //   thrownKind(... 300 ...) === 'RangeError'
  // The second is the interesting one: 45 is 301 wrapped, which is the CAST
  // rule applied at a boundary the table says is checked. A cast wraps and a
  // boundary throws, and this site is currently taking the wrong one.
});

// -- Row 7: a value crossing into a typed position through reflection ---------

test('row 7: Reflect.set into a typed field and a typed element', () => {
  expect(thrownKind('class C { x: uint8 = 1; } const c = new C(); Reflect.set(c, "x", 300);')).toBe('RangeError');
  expect(thrownKind('let a: [].<uint8> = [1]; Reflect.set(a, "0", "x");')).toBe('TypeError');
  expect(evaluated('class C { x: uint8 = 1; } const c = new C(); Reflect.set(c, "x", 7); String(c.x is uint8);')).toBe('true');
});

test('row 7b: Reflect.defineProperty checks the value against the declared type', () => {
  expect(thrownKind('const o = {}; Reflect.defineProperty(o, "x", { value: 300, type: uint8, writable: true, enumerable: true, configurable: true });')).toBe('RangeError');
  expect(evaluated('const o = {}; Reflect.defineProperty(o, "x", { value: 7, type: uint8, writable: true, enumerable: true, configurable: true }); String(o.x is uint8);')).toBe('true');
});

// -- The deletion rule of the same clause ----------------------------------

test('deleting a typed field, a typed element, or an interface-required member throws', () => {
  // The first and third only started throwing when class fields began
  // recording their declared type (F51): the rule was implemented, and the
  // structure it reads was empty for every declared field.
  expect(thrownKind('class C { x: uint8 = 1; } const c = new C(); delete c.x;')).toBe('TypeError');
  expect(thrownKind('let a: [].<uint8> = [1,2]; delete a[0];')).toBe('TypeError');
  expect(thrownKind('interface I { m: uint8 } class C implements I { m: uint8 = 1; } const c = new C(); delete c.m;')).toBe('TypeError');
  // An untyped property is still deletable, and so is a non-index property of
  // a typed array.
  expect(evaluated('class C { y = 1; } const c = new C(); delete c.y; "deleted";')).toBe('deleted');
  expect(evaluated('let a: [].<uint8> = [1,2]; a.custom = 1; delete a.custom; "deleted";')).toBe('deleted');
});

// -- The property the table exists to guarantee -------------------------------

test('the same operation runs at every row: one value, seven boundaries, one verdict', () => {
  // 300 is not a uint8 anywhere, and the report is a RangeError everywhere,
  // because every row runs RequireType and RequireType has one definition.
  // Row 6 is absent from this list because it is not implemented; see its own
  // test above, where the gap is pinned.
  const cases = [
    'function anyv() { return 300; } let x: uint8 = anyv();',
    'function f(v: uint8) {} function anyv() { return 300; } f(anyv());',
    'function anyv() { return 300; } function g(): uint8 { return anyv(); } g();',
    'class C { x: uint8 = 1; } const c = new C(); c.x = 300;',
    'class C { #p: uint8 = 1; set(v) { this.#p = v; } } new C().set(300);',
    'let a: [].<uint8> = [1]; a[0] = 300;',
    'class C { x: uint8 = 1; } const c = new C(); Reflect.set(c, "x", 300);',
  ];
  for (const source of cases) {
    expect(thrownKind(source)).toBe('RangeError');
  }
});

test('a typed field survives a round trip, which is what the gap destroyed', () => {
  // Before F51 this program stored 300 in a uint8 field, and the error then
  // arrived at the READ - an innocent boundary blaming a value the type system
  // had admitted. Now the store is where it is reported.
  expect(thrownKind('class C { x: uint8 = 1; } const c = new C(); c.x = 300; let y: uint8 = c.x;')).toBe('RangeError');
  expect(evaluated('class C { x: uint8 = 1; } const c = new C(); c.x = 200; let y: uint8 = c.x; String(y);')).toBe('200');
});
