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

/** A program whose error is an Early Error: it is rejected before anything runs. */
function expectStatic(source: string) {
  expect(run(`${source} "unreachable";`)).toMatchObject({ Type: 'throw' });
}

function thrownMessage(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'throw' });
  return ((completion as { Value?: { HostDefinedMessageString?: string } }).Value?.HostDefinedMessageString) ?? '';
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
  // A LITERAL store is now rejected statically, which is what the clause asks
  // for in as many words: "a literal element store follows the literal rule
  // and is rejected" (F56). The run-time check remains the backstop for a
  // value whose type the checker cannot settle, and reports a RangeError
  // there, so both paths are asserted rather than one standing for the other.
  expect(thrownKind(`${a} a[0] = 300;`)).toBe('TypeError');
  expect(thrownKind(`${a} a[0] = "nope";`)).toBe('TypeError');
  expect(thrownKind(`${a} function anyv() { return 300; } a[0] = anyv();`)).toBe('RangeError');
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

test('the checker reports what the static types settle, at the store rows', () => {
  // #table-check-sites rows 4 and 5, STATICALLY (F56). These are Early Errors
  // in never-called functions, so nothing runs; the run-time check stays the
  // backstop for values the checker cannot settle.
  expectStatic('function nc(a: [].<uint8>) { a[0] = 300; }');
  expectStatic('function nc(a: [].<uint8>) { a[0] = "s"; }');
  expectStatic('function nc(o: { x: uint8 }) { o.x = 300; }');
  // Valid stores are untouched, and so are untyped targets.
  expect(evaluated('function nc(a: [].<uint8>) { a[0] = 7; } "ok";')).toBe('ok');
  expect(evaluated('function nc(o: { x: uint8 }) { o.x = 7; } "ok";')).toBe('ok');
  expect(evaluated('function nc(a) { a[0] = 300; } "ok";')).toBe('ok');
  // A CLASS field store is checked too since F57: a class name in a type
  // position now resolves to a nominal instance type carrying its declared
  // fields, so the target's type is visible here exactly as an object type's
  // is. Assignability stays NOMINAL - two classes with identical fields are
  // not interchangeable - which is what the [[Structure]] channel keeps
  // separate from identity.
  expectStatic('class C { x: uint8 = 1; } function nc(c: C) { c.x = 300; }');
  expectStatic('class C { x: uint8 = 1; } function nc(c: C) { c.x = "s"; }');
  expect(evaluated('class C { x: uint8 = 1; } function nc(c: C) { c.x = 7; } "ok";')).toBe('ok');
  expect(evaluated('class C { y = 1; } function nc(c: C) { c.y = "anything"; } "ok";')).toBe('ok');
  expectStatic('class A { x: uint8 = 1; } class B { x: uint8 = 1; } function nc(a: A) { let b: B = a; }');
});

test('a class instance carries its declared fields into the checker', () => {
  // Until F57 a class name in a type position resolved to nothing, so every
  // value of a class type was ~any~: no field's type was visible, no store to
  // one was diagnosed, and no call passing one was checked.
  expectStatic('class C { x: uint8 = 1; } function nc(c: C) { let y: uint16 = c.x; }');
  expectStatic('function nc(c: C) { c.x = 300; } class C { x: uint8 = 1; }');
  // Fields that are not instance fields of the public shape stay invisible:
  // a static field is not on the instance, and a private field is not
  // reachable through a member expression at all.
  expect(evaluated('class C { static s: uint8 = 1; } function nc(c: C) { c.s = 300; } "ok";')).toBe('ok');
  expect(evaluated('class C { #p: uint8 = 1; } function nc(c: C) { c.q = 300; } "ok";')).toBe('ok');
  // And the diagnostic names the classes, which it could not do while nominal
  // types printed as the word "nominal".
  const message = thrownMessage('class Apple { x: uint8 = 1; } class Orange { x: uint8 = 1; } function nc(a: Apple) { let b: Orange = a; } "unreachable";');
  expect(message).toContain('Apple');
  expect(message).toContain('Orange');
});

test('a field initializer is a store to that field, and is converted like one', () => {
  // The one check site that skipped the conversion (F57): a field with NO
  // initializer got a typed default and a field written after construction got
  // a typed value, but a field with an initializer kept whatever the
  // initializer produced - so `new C().x is uint8` was FALSE until something
  // wrote to it, and became true afterwards.
  expect(evaluated('class C { x: uint8 = 1; } String(new C().x is uint8);')).toBe('true');
  expect(evaluated('class C { x: uint8 = 7; } String(new C().x);')).toBe('7');
  expect(evaluated('class C { x: uint8; } String(new C().x is uint8);')).toBe('true');
  expect(evaluated('function g() { return 5; } class C { x: uint8 = g(); } String(new C().x is uint8);')).toBe('true');
  // An initializer whose value the type cannot represent is reported where the
  // initializer runs, and an untyped field is untouched.
  expect(thrownKind('function g() { return 300; } class C { x: uint8 = g(); } new C();')).toBe('RangeError');
  expect(evaluated('class C { y = "s"; } String(new C().y);')).toBe('s');
});

test('a call to a declared function is argument-checked', () => {
  // The site was wired all along; what was missing is that the checker never
  // learned a DECLARED function's signature, so no call to one was checked at
  // all (F55 measured it, F56 fixed it).
  expectStatic('function f(v: uint8) {} function nc() { f(300); }');
  expectStatic('function f(v: uint8) {} function nc() { f("s"); }');
  expectStatic('function f(a, b: uint8) {} function nc() { f(999, 300); }');
  // Hoisting: a call may precede the declaration, as JavaScript allows.
  expectStatic('function nc() { f(300); } function f(v: uint8) {}');
  // Untyped parameters, rest parameters, and destructuring parameters leave
  // the name unchecked rather than half-described.
  expect(evaluated('function f(v) {} function nc() { f(300); } "ok";')).toBe('ok');
  expect(evaluated('function f(...xs: uint8) {} function nc() { f(300); } "ok";')).toBe('ok');
  expect(evaluated('function d({ a }) {} function nc() { d(300); } "ok";')).toBe('ok');
  // An OVERLOADED name is resolved statically since F58, by the same ranker the
  // run time uses: the row is selected first, then its parameter is checked, so
  // a literal that cannot take the chosen row's type is reported against it.
  expectStatic('function g(v: uint8) {} function g(v: string) {} function nc() { g(300); }');
  expect(evaluated('function h(v: uint8) { return "u8"; } function h(v: string) { return "s"; } String(h("x"));')).toBe('s');
  expect(evaluated('function h(v: uint8) { return "u8"; } function h(v: string) { return "s"; } String(h(7));')).toBe('u8');
  // No viable signature is a type error, as the clause says in as many words.
  expectStatic('function g(v: uint8) {} function g(v: string) {} function nc() { g(true); }');
  // An argument whose static type is unknown is ~any~, and the clause defers
  // such a resolution to run time rather than guessing.
  expect(evaluated('function h(v: uint8) { return "u8"; } function h(v: string) { return "s"; } function anyv() { return "x"; } String(h(anyv()));')).toBe('s');
  // The untyped catch-all: the clause's own example, which NEITHER the run
  // time nor the checker implemented before (F58).
  expect(evaluated('function g() { return "none"; } function g(a: uint8) { return "u8"; } String(g(1)) + "/" + String(g(1, 2));')).toBe('u8/none');
  expect(evaluated('function g() { return "none"; } function g(a: uint8) { return "u8"; } function anyv() { return 1; } String(g(anyv(), anyv()));')).toBe('none');
  // Declaring a return type is what makes a zero-parameter function typed, so
  // it stops being a catch-all.
  expectStatic('function h(): void { } function h(a: uint8) { return "u8"; } function nc() { h(1, 2); }');
  // And a valid call still runs, with the return type now known to the caller.
  expect(evaluated('function f(v: uint8) { return v; } String(f((7 := uint8)));')).toBe('7');
  expectStatic('function f(): uint8 { return (7 := uint8); } function nc() { let x: uint16 = f(); }');
});

// -- Row 6: an `any` value read into an operator whose operands are typed -----

test('row 6: a value of the any type reaching a typed operator', () => {
  // Implemented in F52, and the specification turned out to say something
  // stronger than this row alone: #sec-arithmetic-never-promotes makes two
  // operands of different numeric types a type error outright, and defers the
  // check to run time only where an operand has the `any` type - which is this
  // row. So an `any` value meeting a typed operand throws when their types
  // differ, rather than being converted into the typed operand's type.
  expect(thrownKind('function anyv() { return 300; } const t = (1 := uint8); t + anyv();')).toBe('TypeError');
  expect(thrownKind('function anyv() { return 2; } const t = (1 := uint8); t + anyv();')).toBe('TypeError');
  // A literal is not an `any` value: it TAKES the type of the other operand,
  // so it never forces a conversion and never reaches this row.
  expect(evaluated('String((1 := uint8) + 1) + "/" + String(((1 := uint8) + 1) is uint8);')).toBe('2/true');
  // A literal that cannot take that type is out of range, and the run-time
  // backstop reports it as one.
  expect(thrownKind('(1 := uint8) + 300;')).toBe('RangeError');
  // The string behaviour of `+` is explicitly unchanged and applies FIRST:
  // uint8(1) + "x" is "1x" by #sec-operator-dispatch, which is why this line
  // is an assertion rather than a gap.
  expect(evaluated('function anyv() { return "s"; } const t = (1 := uint8); String(t + anyv());')).toBe('1s');
});

test('the relational operators take the same rule as the arithmetic ones', () => {
  // "an arithmetic, bitwise, shift, or RELATIONAL operator" - the clause names
  // them together, and comparison does not route through
  // ApplyStringOrNumericBinaryOperator, so it needed the rule separately and
  // did not have it: `(1 := uint8) < (2 := uint16)` answered true (F53).
  expect(thrownKind('(1 := uint8) < (2 := uint16);')).toBe('TypeError');
  expect(thrownKind('(1 := uint8) >= (2 := uint16);')).toBe('TypeError');
  expect(thrownKind('function anyv() { return 2; } (1 := uint8) < anyv();')).toBe('TypeError');
  expect(thrownKind('(1 := uint8) < 300;')).toBe('RangeError');
  // A typed value does not compare with a BigInt either, which the comparison
  // path would otherwise do by its own BigInt cases.
  expect(thrownKind('(1 := uint8) < 2n;')).toBe('TypeError');
  expect(thrownKind('2n < (1 := uint8);')).toBe('TypeError');
  // Same type compares; a literal takes the type; untyped and BigInt-only and
  // string comparisons are untouched.
  expect(evaluated('String((1 := uint8) < (2 := uint8));')).toBe('true');
  expect(evaluated('String((1 := uint8) < 2);')).toBe('true');
  expect(evaluated('String(1 < (2 := uint8));')).toBe('true');
  expect(evaluated('String(1 < 2) + "/" + String(1n < 2n) + "/" + String(1n < 2) + "/" + String("a" < "b");')).toBe('true/true/true/true');
  // A String operand is not a numeric type, so the clause does not reach it and
  // the existing coercion governs - the same reason `+` keeps concatenating.
  expect(evaluated('String((1 := uint8) < "2");')).toBe('true');
});

test('two typed operands of different types do not mix, exactly as BigInt does not', () => {
  // "`uint8(1) + uint16(1)` throws for exactly the same reason `1n + 1` does,
  // by the same step, with no rule specific to it." The engine promoted
  // instead, silently, at every arithmetic operator (F52).
  expect(thrownKind('(1 := uint8) + (1 := uint16);')).toBe('TypeError');
  expect(thrownKind('(1 := int32) * (2 := float64);')).toBe('TypeError');
  expect(thrownKind('(5 := uint8) + 5n;')).toBe('TypeError');
  // The same type is fine, and stays that type.
  expect(evaluated('String((1 := uint8) + (2 := uint8)) + "/" + String(((1 := uint8) + (2 := uint8)) is uint8);')).toBe('3/true');
  // Untyped arithmetic is untouched.
  expect(evaluated('String(1 + 2);')).toBe('3');
  expect(evaluated('String(1 + "s");')).toBe('1s');
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

test('a typed array reads its length at uint32, and an untyped one does not', () => {
  // "`length` is a `uint32`" (sec-array-defaults-and-stores). The STORED length
  // stays a plain Number - the array exotic object asserts that it is one and
  // ArraySetLength computes with it - so the typing is applied at the read
  // (F54).
  expect(evaluated('let a: [].<uint8> = [1,2,3]; String(a.length is uint32) + "/" + String(a.length);')).toBe('true/3');
  expect(evaluated('const b = [1,2,3]; String(b.length is uint32) + "/" + String(b.length);')).toBe('false/3');
  // Everything that computes with the length still works: growing, truncating,
  // the library methods, and iteration.
  expect(evaluated('let a: [].<uint8> = [1]; a.push((2 := uint8)); String(a.length) + "/" + String(a.length is uint32);')).toBe('2/true');
  expect(evaluated('let a: [].<uint8> = [1,2,3]; a.length = 2; String(a.length) + "/" + String(a.join(","));')).toBe('2/1,2');
  expect(evaluated('let a: [].<uint8> = [1,2,3]; String(a.slice(1).length) + "/" + String(a.join(","));')).toBe('2/1,2,3');
  expect(evaluated('let a: [].<uint8> = [1,2,3]; let n = 0; for (const x of a) { n += 1; } String(n);')).toBe('3');
});

test('the price of a typed length, pinned so it is a decision and not a surprise', () => {
  // TWO idioms change for a typed array, and both follow from rules this
  // proposal states elsewhere rather than from anything about length.
  //
  // The canonical counting loop needs a typed counter, because i declared as
  // let i = 0 is a Number and a Number does not mix with a uint32
  // (sec-arithmetic-never-promotes). Every statically typed language asks for
  // this - it is size_t in C - but it is the most common loop in JavaScript,
  // so it is pinned here rather than left to be discovered.
  expect(thrownKind('let a: [].<uint8> = [1,2,3]; for (let i = 0; i < a.length; ++i) { }')).toBe('TypeError');
  expect(evaluated('let a: [].<uint8> = [1,2,3]; let n = 0; for (let i = (0 := uint32); i < a.length; ++i) { n += 1; } String(n);')).toBe('3');
  // And strict equality against a plain literal is false, because a typed value
  // and a Number are different types (R1) - the same reason (3 := uint8) === 3
  // is false. Loose equality still coerces.
  expect(evaluated('let a: [].<uint8> = [1,2,3]; String(a.length === 3) + "/" + String(a.length == 3);')).toBe('false/true');
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
  // Each case routes the value through an ~any~ position where the checker
  // would otherwise reject the literal earlier and statically, which is a
  // different (and better) answer but not the one this test is about.
  // Row 6 joins the list as of F52, with its own kind: a value of the `any`
  // type meeting a typed operand is a MIX rather than an out-of-range value,
  // so it is a TypeError where the storage rows give a RangeError. The
  // operation is the same; what differs is what went wrong.
  const cases = [
    'function anyv() { return 300; } let x: uint8 = anyv();',
    'function f(v: uint8) {} function anyv() { return 300; } f(anyv());',
    'function anyv() { return 300; } function g(): uint8 { return anyv(); } g();',
    'class C { x: uint8 = 1; } const c = new C(); c.x = 300;',
    'class C { #p: uint8 = 1; set(v) { this.#p = v; } } new C().set(300);',
    'let a: [].<uint8> = [1]; function anyv() { return 300; } a[0] = anyv();',
    'class C { x: uint8 = 1; } const c = new C(); Reflect.set(c, "x", 300);',
  ];
  // Row 6's own form, asserted beside them: same operation, different fault.
  expect(thrownKind('function anyv() { return 300; } (1 := uint8) + anyv();')).toBe('TypeError');
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
