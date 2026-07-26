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

test('a class method is checked like a call, and an overloaded one ranks', () => {
  // Methods join the class's [[Structure]] as function types (F59), so the
  // call site's existing argument checking covers them.
  expectStatic('class C { m(v: uint8) { return v; } } function nc(c: C) { c.m(300); }');
  expectStatic('class C { m(v: uint8) { return v; } } function nc(c: C) { c.m("s"); }');
  expect(evaluated('class C { m(v: uint8) { return v; } } function nc(c: C) { c.m(7); } "ok";')).toBe('ok');
  // A method's return type flows to the caller.
  expectStatic('class C { m(): uint8 { return (1 := uint8); } } function nc(c: C) { let x: uint16 = c.m(); }');
  // Methods are overloadable, so their signatures accumulate and rank exactly
  // as a function's do.
  expect(evaluated('class C { m(v: uint8) { return "u8"; } m(v: string) { return "s"; } } String(new C().m("x"));')).toBe('s');
  expectStatic('class C { m(v: uint8) { return "u8"; } m(v: string) { return "s"; } } function nc(c: C) { c.m(300); }');
  // A getter reads at its declared return type.
  expectStatic('class C { get g(): uint8 { return (1 := uint8); } } function nc(c: C) { let x: uint16 = c.g; }');
  // Static and private members are not part of the instance shape, and an
  // untyped method leaves its call unchecked.
  expect(evaluated('class C { static m(v: uint8) {} } function nc(c: C) { c.m(300); } "ok";')).toBe('ok');
  expect(evaluated('class C { #m(v: uint8) {} } function nc(c: C) { c.m(300); } "ok";')).toBe('ok');
  expect(evaluated('class C { m(v) { return v; } } function nc(c: C) { c.m(300); } "ok";')).toBe('ok');
});

test('Infinity and NaN are metadata values, so a bound can state its own default', () => {
  // #table-metadata-values admits "a Number" and says "a NaN is equivalent to a
  // NaN", so the two Numbers written with a NAME rather than a numeral are
  // metadata values like any other. They resolved as type names, found nothing,
  // and failed with "Infinity is not a type" - which left a bounds-shaped meta
  // type unable to state its own default and the suite writing `1e400`, a
  // workaround producing the very same value (F63).
  const bounds = `
    type B = { min: number, max: number };
    meta B {
      default = { min: -Infinity, max: Infinity };
      subtype(a, b) { return b.min <= a.min && a.max <= b.max; }
      validate(v, c) { return Number(v) >= c.min && Number(v) <= c.max; }
    }
  `;
  expect(evaluated(`${bounds} String((5 := float64.<{ min: 0, max: Infinity }>) is float64.<{ min: 0, max: Infinity }>);`)).toBe('true');
  // Writing the default explicitly is what was impossible, and it makes the
  // sit-out reachable: a portion equal to the default takes no part, so any
  // value is admitted.
  expect(evaluated(`${bounds} String((99999 := float64.<{ min: -Infinity, max: Infinity }>));`)).toBe('99999');
  // A real bound still enforces.
  expect(run(`${bounds} (5 := float64.<{ min: 10, max: Infinity }>); "admitted";`)).toMatchObject({ Type: 'throw' });
  // NaN is a metadata value and interns by SameValue, so two NaN metadata are
  // ONE type - which is what the table promises and what interning needs.
  const nan = 'type N = { n: number }; meta N { default = { n: 0 }; subtype(a, b) { return true; } validate(v, c) { return true; } } ';
  expect(evaluated(`${nan} String(float64.<{ n: NaN }> === float64.<{ n: NaN }>);`)).toBe('true');
  // A bare identifier in a type position is still a type reference, and only
  // these two names are numerals behind a minus.
  expect(run('type T = float64.<{ n: -Other }>; "ok";')).toMatchObject({ Type: 'throw' });
});

test('a refused crossing names the meta type and uses its describe hook', () => {
  // #sec-primitive-metadata requires both failure arms to throw a TypeError
  // "whose message names M and, where M defines `describe`, its descriptions".
  // The hook was declarable since cycle 37 and called by nothing: the engine
  // threw its generic "$1 is not assignable to $2" (F62).
  const dims = `
    type Dim = { m: number, s: number };
    meta Dim {
      default = { m: 0, s: 0 };
      subtype(a, b) { return a.m === b.m && a.s === b.s; }
      validate(v, c) { return true; }
      describe(c) { return "metres^" + c.m + " seconds^" + c.s; }
    }
  `;
  const message = thrownMessage(`${dims} ((2 := float32.<{ m: 1 }>) := float32.<{ m: 2 }>); "unreachable";`);
  expect(message).toContain('Dim');
  expect(message).toContain('metres^1');
  expect(message).toContain('metres^2');
  // Without a describe hook the message still names the meta type, falling
  // back to the type displays for the portions.
  const bare = `
    type D2 = { m: number };
    meta D2 { default = { m: 0 }; subtype(a, b) { return a.m === b.m; } validate(v, c) { return true; } }
  `;
  expect(thrownMessage(`${bare} ((2 := float32.<{ m: 1 }>) := float32.<{ m: 2 }>); "unreachable";`)).toContain('D2');
  // An admitted crossing is untouched.
  expect(evaluated(`${dims} String((2 := float32.<{ m: 1 }>) := float32.<{ m: 1, s: 0 }>);`)).toBe('2');
});

test('an enum is a subtype of its underlying type, and reflects as an enum', () => {
  // sec-enums says an enum type is a subtype of its underlying type; the
  // relation held nowhere, because the enum's record did not carry the
  // underlying type to relate it to (F62).
  expect(evaluated('enum C: uint8 { A, B }; String(Reflect.isAssignable(C, uint8));')).toBe('true');
  expect(evaluated('enum D { A, B }; String(Reflect.isAssignable(D, number));')).toBe('true');
  // The relation is one-directional and does not reach unrelated types.
  expect(evaluated('enum C: uint8 { A, B }; String(Reflect.isAssignable(uint8, C));')).toBe('false');
  expect(evaluated('enum C: uint8 { A, B }; String(Reflect.isAssignable(C, string));')).toBe('false');
  // A member is still a value of its own enum, and flows to the underlying.
  expect(evaluated('enum C: uint8 { A, B }; String(C.B is C);')).toBe('true');
  expect(evaluated('enum C: uint8 { A, B }; let x: uint8 = C.B; String(x);')).toBe('1');
  // And an enum reflects AS an enum rather than as an indistinguishable
  // primitive leaf, so a walker can read its members and its underlying type.
  expect(evaluated('enum C: uint8 { A, B, E }; const r = Reflect.getReflection(C); String(r.kind) + "/" + String(r.size) + "/" + String(r.underlying.kind);')).toBe('enum/3/primitive');
});

test('an interface is a type, and a class picks up what it implements', () => {
  // The checker resolved an interface name in a type position to NOTHING, so a
  // parameter typed by an interface was ~any~ and nothing about it was checked
  // (F61) - a larger gap than the one this cycle set out to close.
  expectStatic('interface I { k: uint8 } function nc(i: I) { i.k = 300; }');
  expectStatic('interface I { k: uint8 } function nc(i: I) { let x: uint16 = i.k; }');
  expectStatic('interface I { m(v: uint8): void } function nc(i: I) { i.m(300); }');
  expect(evaluated('interface I { k: uint8, m(v: uint8): void } function nc(i: I) { i.k = 7; i.m(7); } "ok";')).toBe('ok');
  // A class has the members of the interfaces it implements, even one it does
  // not declare itself...
  expectStatic('interface I { k: uint8 } class C implements I { } function nc(c: C) { c.k = 300; }');
  // ...and its OWN declaration wins where both describe a member.
  expectStatic('interface I { k: string } class C implements I { k: uint8 = 1; } function nc(c: C) { c.k = 300; }');
  expect(evaluated('interface I { k: uint8 } class C implements I { k: uint8 = 1; } String(new C().k is uint8);')).toBe('true');
});

test('a setter gives a property its write type', () => {
  // A store through an accessor was unchecked while a store to a FIELD of the
  // same name was caught (F61). The write type is kept apart from the read
  // type, because a getter and setter pair may legitimately differ.
  expectStatic('class C { set s(v: uint8) {} } function nc(c: C) { c.s = 300; }');
  expect(evaluated('class C { set s(v: uint8) {} } function nc(c: C) { c.s = 7; } "ok";')).toBe('ok');
  // Differing pair: the store satisfies the SETTER's type and the read yields
  // the GETTER's.
  expectStatic('class C { get p(): string { return "a"; } set p(v: uint8) {} } function nc(c: C) { c.p = 300; }');
  expectStatic('class C { get p(): string { return "a"; } set p(v: uint8) {} } function nc(c: C) { let x: uint8 = c.p; }');
  // The run time is untouched: the setter still converts what it receives.
  expect(evaluated('class C { set s(v: uint8) { this.q = v; } } const c = new C(); c.s = 7; String(c.q is uint8);')).toBe('true');
});

test('a subclass instance carries what it inherits', () => {
  const base = 'class A { x: uint8 = 1; m(v: uint8) { return v; } } class B extends A { y: uint8 = 2; } ';
  // Inherited fields and methods are part of the subclass's shape (F60), which
  // is what the prototype chain gives at run time.
  expectStatic(`${base} function nc(b: B) { b.x = 300; }`);
  expectStatic(`${base} function nc(b: B) { b.m(300); }`);
  expectStatic(`${base} function nc(b: B) { let z: uint16 = b.x; }`);
  expect(evaluated(`${base} function nc(b: B) { b.x = 7; b.m(7); } "ok";`)).toBe('ok');
  // Through more than one level, and regardless of declaration order: the
  // instance types are built lazily, so a class may name a superclass declared
  // later in the list.
  expectStatic('class A { x: uint8 = 1; } class B extends A {} class C extends B {} function nc(c: C) { c.x = 300; }');
  expectStatic('function nc(b: B) { b.x = 300; } class B extends A { } class A { x: uint8 = 1; }');
  // An OVERRIDE wins over what it overrides, which is again what the prototype
  // chain does.
  expect(evaluated('class A { m(v: uint8) {} } class B extends A { m(v: string) {} } function nc(b: B) { b.m("s"); } "ok";')).toBe('ok');
  expectStatic('class A { m(v: uint8) {} } class B extends A { m(v: string) {} } function nc(b: B) { b.m(300); }');
  // A heritage clause that is not a class name leaves the base unknown, which
  // contributes nothing rather than guessing; and a heritage CYCLE must not
  // hang the checker, though it is a ReferenceError when the program runs.
  expect(evaluated('function mixin(x) { return x; } class A { x: uint8 = 1; } class B extends mixin(A) {} function nc(b: B) { b.x = 300; } "ok";')).toBe('ok');
  expect(run('class A extends B {} class B extends A {} "ok";')).toMatchObject({ Type: 'throw' });
  // The run time is untouched: inherited values are still typed.
  expect(evaluated(`${base} String(new B().x is uint8) + "/" + String(new B().y);`)).toBe('true/2');
});

test('a constructor is a construct signature, not a member of the instance', () => {
  // `new C(...)` is checked against the constructor's parameters (F59)...
  expectStatic('class C { constructor(v: uint8) {} } function nc() { new C(300); }');
  expect(evaluated('class C { constructor(v: uint8) {} } function nc() { new C(7); } "ok";')).toBe('ok');
  // ...and the constructor is NOT an instance method: `c.constructor` is the
  // class, so typing it as a method taking the constructor's parameters would
  // be wrong twice over.
  expect(evaluated('class C { constructor(v: uint8) {} } function nc(c: C) { c.constructor(300); } "ok";')).toBe('ok');
  // `new C()` has the class's instance type, so a field read through it flows.
  expectStatic('class C { x: uint8 = 1; } function nc() { let y: uint16 = new C().x; }');
  // An untyped or absent constructor leaves the call unchecked, and the
  // construction still runs.
  expect(evaluated('class C { constructor(v) {} } function nc() { new C(300); } "ok";')).toBe('ok');
  expect(evaluated('class C { x: uint8 = 1; } function nc() { new C(300); } "ok";')).toBe('ok');
  expect(evaluated('class C { constructor(v: uint8) { this.v = v; } } String(new C((7 := uint8)).v);')).toBe('7');
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

test('a typed Set takes its element positions at the element type', () => {
  // A collection's type arguments were carried syntactically and dropped
  // semantically: `Set.<uint8>` parsed, constructed, and checked nothing, so
  // `s.add(300)` was accepted and stored a plain Number (F72). An array gets
  // its element type from the conversion that builds it; a collection needs
  // the same stamp, because `new Set()` is a construction rather than a
  // conversion.
  const s = 'let s: Set.<uint8> = new Set(); ';
  expect(evaluated(`${s} s.add(65); String([...s][0] is uint8);`)).toBe('true');
  // MIGRATED TO STATIC FORM: a LITERAL the element type cannot hold is now an
  // Early Error, since the checker knows these signatures. The run-time kinds
  // these lines used to assert are asserted below through the `any` path,
  // which is where the runtime backstop still lives - the same migration the
  // array methods' assertions made when they gained signatures (F70/F37).
  expectStatic(`${s} s.add(300);`);
  expectStatic(`${s} s.add("x");`);
  expect(thrownKind(`${s} function anyv() { return 300; } s.add(anyv());`)).toBe('RangeError');
  expect(thrownKind(`${s} function anyv() { return "x"; } s.add(anyv());`)).toBe('TypeError');
  // A literal needle finds what the set holds, and so does a typed one, and one
  // of another family converts through the same boundary.
  expect(evaluated(`${s} s.add(65); String(s.has(65));`)).toBe('true');
  expect(evaluated(`${s} s.add(65); String(s.has((65 := uint8)));`)).toBe('true');
  // A needle of ANOTHER numeric family is a static type error, uniformly: the
  // checker rejects a `uint16` where a `uint8` is required at a binding, at a
  // parameter, and at an array method, and a collection method is now the same
  // position. Reaching the boundary through a path the checker cannot see, the
  // run time still converts it, which is the backstop that assertion was
  // really about.
  expectStatic(`${s} s.has((65 := uint16));`);
  expect(evaluated(`${s} s.add(65); function anyv() { return (65 := uint16); } String(s.has(anyv()));`)).toBe('true');
  expect(evaluated(`${s} s.add(65); String(s.delete(65)) + "/" + String(s.size);`)).toBe('true/0');
  expect(evaluated(`${s} s.add(65); s.add(65); String(s.size);`)).toBe('1');
  // An untyped Set constrains nothing, exactly as an untyped array does not.
  expect(evaluated('const u = new Set(); u.add(300); u.add("x"); String(u.size);')).toBe('2');
});

test('a typed collection checks every position it declares, at any type', () => {
  // The conversion at these methods used to be SYNCHRONOUS, and so reached the
  // NUMERIC element types and no others: a `Set.<string>` checked nothing at
  // all. That is F51's shape again - a second, narrower operation beside the
  // one the specification has - and the fix is the same, to call RequireType.
  // Being a generator is what buys the rest of the type space.
  const ss = 'let s: Set.<string> = new Set(); ';
  expect(thrownKind(`${ss} function anyv() { return {}; } s.add(anyv());`)).toBe('TypeError');
  expect(thrownKind(`${ss} function anyv() { return {}; } s.has(anyv());`)).toBe('TypeError');
  expect(thrownKind(`${ss} function anyv() { return {}; } s.delete(anyv());`)).toBe('TypeError');
  // The conversion is the array's conversion, so it behaves identically: a
  // lossless source converts rather than failing, exactly as `a.push(5)` on a
  // `[].<string>` has always produced the string "5".
  expect(evaluated(`${ss} function anyv() { return 5; } s.add(anyv()); String(typeof [...s][0]);`)).toBe('string');

  const mm = 'let m: Map.<string, uint8> = new Map(); ';
  expect(thrownKind(`${mm} function anyv() { return {}; } m.get(anyv());`)).toBe('TypeError');
  expect(thrownKind(`${mm} function anyv() { return 300; } m.set("a", anyv());`)).toBe('RangeError');
  expect(thrownKind(`${mm} function anyv() { return {}; } m.has(anyv());`)).toBe('TypeError');
  expect(evaluated(`${mm} m.set("a", 65); String(m.get("a") is uint8);`)).toBe('true');

  // `getOrInsert` is a store however it is spelled, and it was checking NEITHER
  // position - not even the numeric ones the old helper did reach. Found while
  // lifting that limit.
  const mu = 'let m: Map.<uint8, uint8> = new Map(); ';
  expect(thrownKind(`${mu} function anyv() { return 300; } m.getOrInsert(anyv(), 1);`)).toBe('RangeError');
  expect(thrownKind(`${mu} function anyv() { return 300; } m.getOrInsert(1, anyv());`)).toBe('RangeError');
  expect(thrownKind(`${mu} function anyv() { return 300; } m.getOrInsertComputed(1, () => anyv());`)).toBe('RangeError');
  expect(evaluated(`${mu} String(m.getOrInsert(1, 65) is uint8);`)).toBe('true');

  // The weak collections carry the same stamp and had no consumer for it, so a
  // typed position the checker reported was accepted by the run time.
  const wm = 'let w: WeakMap.<object, uint8> = new WeakMap(); const o = {}; ';
  expect(thrownKind(`${wm} function anyv() { return 300; } w.set(o, anyv());`)).toBe('RangeError');
  expect(evaluated(`${wm} w.set(o, 65); String(w.get(o) is uint8);`)).toBe('true');

  // An untyped collection constrains nothing, exactly as an untyped array does
  // not - the control that keeps this from being a change to every program.
  expect(evaluated('const u = new Set(); u.add(300); u.add({}); String(u.size);')).toBe('2');
  expect(evaluated('const u = new Map(); u.set({}, 300); String(u.size);')).toBe('1');
});

test('a set operation\'s result carries the element type its values can come from', () => {
  // standardlibrary.md writes these out: `intersection` and `difference` draw
  // only from `this`, so the result keeps T; `union` and `symmetricDifference`
  // draw from both, so the result holds `T | U`. Both halves land together
  // deliberately - a checker that says `Set.<uint8>` over a run time holding an
  // unstamped Set is the disagreement cycle 76 was about.
  const two = 'let a: Set.<uint8> = new Set(); a.add(1); let b: Set.<uint16> = new Set(); b.add(1000); ';
  // RUN TIME: the result was UNSTAMPED, so the typed surface switched off for
  // everything downstream - `s.union(o).add(300)` was accepted on two
  // `Set.<uint8>` operands. F71's shape, at a different producer.
  expect(thrownKind(`${two} const u = a.union(b); u.add("x");`)).toBe('TypeError');
  // 1000 converts at the uint16 arm of the union and the set ALREADY holds
  // that value, so it dedupes: the conversion happening is what makes the two
  // the same value rather than two.
  expect(evaluated(`${two} const u = a.union(b); u.add(1000); String(u.size);`)).toBe('2');
  expect(thrownKind(`${two} const i = a.intersection(b); function anyv() { return 300; } i.add(anyv());`)).toBe('RangeError');
  // The receiver's type survives against an UNTYPED other, because those
  // elements can only have come from the receiver.
  expect(thrownKind(`${two} const d = a.difference(new Set([1])); function anyv() { return 300; } d.add(anyv());`)).toBe('RangeError');
  // A union WITH an untyped set is deliberately unconstrained: `T | U` is
  // unknown when U is, and answering `Set.<T>` would be a claim the values do
  // not support.
  expect(evaluated(`${two} const m = a.union(new Set([1])); m.add("x"); String(m.size);`)).toBe('3');

  // STATICALLY, proved by rejection.
  expectStatic('function f(s: Set.<uint8>) { let b: string = s.union(s); }');
  expectStatic('function f(s: Set.<uint8>) { let b: string = s.intersection(s); }');
  expectStatic('function f(s: Set.<uint8>) { let b: string = s.isSubsetOf(s); }');
  // The union of two DIFFERENT element types is neither one of them.
  expectStatic('function f(s: Set.<uint8>, o: Set.<uint16>) { let b: Set.<uint8> = s.union(o); }');
  expect(evaluated('function f(s: Set.<uint8>, o: Set.<uint16>) { let b: Set.<uint8 | uint16> = s.union(o); } "ok";')).toBe('ok');
  expect(evaluated('function f(s: Set.<uint8>) { let b: Set.<uint8> = s.intersection(s); } "ok";')).toBe('ok');
  expect(evaluated('function f(s: Set.<uint8>) { let b: boolean = s.isDisjointFrom(s); } "ok";')).toBe('ok');
  // An untyped operand leaves the result unknown rather than wrong.
  expect(evaluated('function f(s: Set.<uint8>, o) { let b: string = s.union(o); } "ok";')).toBe('ok');
});

test('the checker knows a typed collection\'s method signatures', () => {
  // The static half, and the array methods' one remaining asymmetry: a literal
  // the declared type cannot hold is an Early Error rather than a run-time
  // one. Proved by REJECTION inside a never-called function, since every
  // positive passes against a checker that knows nothing (F79).
  expectStatic('function f(s: Set.<uint8>) { s.add(300); }');
  expectStatic('function f(s: Set.<uint8>) { s.has(300); }');
  expectStatic('function f(s: Set.<uint8>) { s.delete(300); }');
  expectStatic('function f(s: Set.<string>) { s.add(5); }');
  expectStatic('function f(m: Map.<string, uint8>) { m.set("a", 300); }');
  expectStatic('function f(m: Map.<string, uint8>) { m.get(5); }');
  expectStatic('function f(m: Map.<string, uint8>) { m.has(5); }');
  expectStatic('function f(w: WeakMap.<object, uint8>) { w.set({}, 300); }');
  // The signatures are the DESIGN's, and its lookup returns `V | undefined`:
  // a lookup that finds nothing answers undefined, so a binding of the value
  // type is a mistake the types can see.
  expectStatic('function f(m: Map.<string, uint8>) { let x: uint8 = m.get("a"); }');
  // The positive forms typecheck, including the returns the design declares:
  // `has` answers a boolean and `add` answers the set itself, for chaining.
  expect(evaluated('function f(s: Set.<uint8>) { let b: boolean = s.has(5); let t: Set.<uint8> = s.add(5); } "ok";')).toBe('ok');
  expect(evaluated('function f(m: Map.<string, uint8>) { let x: uint8 | undefined = m.get("a"); } "ok";')).toBe('ok');
  // An UNTYPED collection has no declared type to check against, so nothing
  // here reaches an ordinary program.
  expect(evaluated('function f(s: Set) { s.add(300); s.add("x"); } "ok";')).toBe('ok');
});

test('a test narrows the binding it guards', () => {
  // Phase 4 of the checker plan: the checker rejected the very idiom the `is`
  // operator exists for, because a binding kept its union type inside the
  // branch the test guarded (F75). The narrowing operations already existed;
  // nothing consulted them for a binding.
  expect(evaluated('function nc(x: uint8 | string) { if (x is uint8) { let y: uint8 = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | string | boolean) { if (x is uint8) { let y: uint8 = x; } } "ok";')).toBe('ok');
  // The ELSE branch takes the complement, and a negated test swaps the two.
  expect(evaluated('function nc(x: uint8 | string) { if (x is uint8) { } else { let y: string = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | string) { if (!(x is uint8)) { let y: string = x; } } "ok";')).toBe('ok');
  // The narrowing is still a TYPE: the other arm is rejected in each branch.
  expectStatic('function nc(x: uint8 | string) { if (x is uint8) { let y: string = x; } }');
  expectStatic('function nc(x: uint8 | string) { if (x is uint8) { } else { let y: uint8 = x; } }');
  // And it does not leak past the statement it guards.
  expectStatic('function nc(x: uint8 | string) { if (x is uint8) { } let y: uint8 = x; }');
  // Nesting works, which is what makes a chain of tests usable.
  expect(evaluated('function nc(x: uint8 | string | boolean) { if (x is uint8) { let y: uint8 = x; } else { if (x is string) { let z: string = x; } } } "ok";')).toBe('ok');
  // The run time is untouched: `is` decides the same branch it always did.
  expect(evaluated('function f(x: uint8 | string) { if (x is uint8) { return "u8"; } return "s"; } String(f((5 := uint8))) + "/" + String(f("a"));')).toBe('u8/s');
});

test('every narrowing form the checker reads, and where it applies', () => {
  // The forms of sec-narrowing that speak about a binding (F76), each in both
  // branches. `typeof`, a null or undefined test, and an equality against a
  // literal join the `is` form of F75.
  expect(evaluated('function nc(x: uint8 | string) { if (typeof x === "string") { let y: string = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | string) { if (typeof x === "string") { } else { let y: uint8 = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | string) { if (typeof x !== "string") { let y: uint8 = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | null) { if (x !== null) { let y: uint8 = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | null) { if (x != null) { let y: uint8 = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: 1 | 2) { if (x === 1) { let y: 1 = x; } } "ok";')).toBe('ok');
  // And the forms that guard something other than an `if`: a `while` body and
  // the arms of a conditional.
  expect(evaluated('function nc(x: uint8 | string) { while (x is uint8) { let y: uint8 = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | string) { const r = x is uint8 ? ((y: uint8) => y)(x) : 0; } "ok";')).toBe('ok');
});

test('a typed array length and element-preserving results flow statically', () => {
  // Phase 5 of the checker plan. Asserted by REJECTION, because a permissive
  // checker passes every positive test: only a rejection proves it knows the
  // type. Measuring this way is what showed the pieces were undone, since each
  // one looked fine from its positive case alone (F79).
  //
  // "The Static Type of a member access reading the `length` property of an
  // array is `uint32`" - the run time has done this since F54, this is the
  // static half.
  expectStatic('function nc(a: [].<uint8>) { let n: string = a.length; }');
  expectStatic('function nc(a: [].<uint8>) { let n: uint8 = a.length; }');
  expect(evaluated('function nc(a: [].<uint8>) { let n: uint32 = a.length; } "ok";')).toBe('ok');
  // A result drawn from the receiver's own elements is an array of the SAME
  // element type.
  expectStatic('function nc(a: [].<uint8>) { let b: string = a.filter(x => true); }');
  expectStatic('function nc(a: [].<uint8>) { let b: [].<string> = a.filter(x => true); }');
  expectStatic('function nc(a: [].<uint8>) { let b: [].<string> = a.slice(0); }');
  expectStatic('function nc(a: [].<uint8>) { let b: [].<string> = a.sort(); }');
  expect(evaluated('function nc(a: [].<uint8>) { let b: [].<uint8> = a.filter(x => true); } "ok";')).toBe('ok');
  // `map` DOES flow since F80, once the callback could be typed: its element
  // type is the callback's return, so a `[].<uint8>` mapped to strings is a
  // string array and not a number one.
  expectStatic('function nc(a: [].<uint8>) { let b: [].<uint8> = a.map(x => "s"); }');
  expectStatic('function nc(a: [].<uint8>) { let b: [].<string> = a.map(x => x); }');
  expect(evaluated('function nc(a: [].<uint8>) { let b: [].<string> = a.map(x => "s"); } "ok";')).toBe('ok');
  // An untyped array declares no element type and constrains nothing.
  expect(evaluated('function nc(a) { let n: string = a.length; } "ok";')).toBe('ok');
  // The run time is untouched.
  expect(evaluated('let a: [].<uint8> = [3,1]; String(a.filter(x => true)[0] is uint8) + "/" + String(a.length);')).toBe('true/2');
});

test('a check the static types already establish is not inserted', () => {
  // #sec-check-elision: "A check is required only where the static types do not
  // already establish the result." Phase 6 (F81). The plan asked for a DIRECT
  // assertion that the check is gone, since behavioural equivalence cannot
  // distinguish an elision from a no-op - so the observation is a getter, since
  // an object type's membership check READS the properties.
  const src = 'let reads = 0; const o = { get a() { reads += 1; return (5 := uint8); } }; ';
  expect(evaluated(`${src} function f(s: { a: uint8 }) { reads = 0; let t: { a: uint8 } = s; return reads; } String(f(o));`)).toBe('0');
  expect(evaluated(`${src} function g(s) { reads = 0; let t: { a: uint8 } = s; return reads; } String(g(o));`)).toBe('1');
  // The value is unchanged either way, which is the property that makes the
  // elision legitimate rather than a behaviour change.
  expect(evaluated('const s = (5 := uint8); let x: uint8 = s; String(x) + "/" + String(x is uint8);')).toBe('5/true');
  expect(evaluated('function f(s: uint8) { let t: uint8 | string = s; return t is uint8; } String(f((5 := uint8)));')).toBe('true');
  // WHAT IS NOT ELIDED, and the first is the correctness argument: a LITERAL is
  // assignable to `uint8` and still must be CONVERTED, so assignability alone
  // does not license skipping the boundary. An ~any~ source is not elided
  // either, which is the case the checks exist for.
  expect(evaluated('let x: uint8 = 5; String(x is uint8);')).toBe('true');
  expect(thrownKind('function anyv() { return 300; } let x: uint8 = anyv();')).toBe('RangeError');
});

test('the RETURN boundary elides too, and the condition is a property of the function', () => {
  // Phase 6 at the second of its four boundaries. The binding boundary could
  // be decided at the ANNOTATION, because a binding has one initializer; a
  // return annotation is shared by every `return` in the function, so the
  // decision is a property of the FUNCTION: every return must be proven, and
  // the body must end in one, since falling off the end hands back *undefined*
  // and no numeric or object annotation admits it.
  const src = 'let reads = 0; const o = { get a() { reads += 1; return (5 := uint8); } }; ';
  expect(evaluated(`${src} function f(s: { a: uint8 }): { a: uint8 } { reads = 0; return s; } f(o); String(reads);`)).toBe('0');
  expect(evaluated(`${src} function g(s): { a: uint8 } { reads = 0; return s; } g(o); String(reads);`)).toBe('1');
  // ONE unproven return spoils the function, which is what makes this a
  // whole-function property rather than a per-statement one.
  expect(evaluated(`${src} function h(s: { a: uint8 }, c): { a: uint8 } { reads = 0; if (c) { return c; } return s; } h(o, 0); String(reads);`)).toBe('1');
  // The value is unchanged either way, and the cases the boundary exists for
  // are untouched: a LITERAL is assignable and still must be CONVERTED, and an
  // ~any~ return is still checked.
  expect(evaluated('function f(): uint8 { return 5; } String(f() is uint8);')).toBe('true');
  expect(thrownKind('function anyv() { return 300; } function f(): uint8 { return anyv(); } f();')).toBe('RangeError');
  expect(evaluated('function f(s: uint8): uint8 { return s; } String(f((5 := uint8)) is uint8);')).toBe('true');
  // A `return;` with no expression hands back *undefined*, so the function is
  // not elided even though it has no unproven expression in it.
  expect(thrownKind('function anyv() { return 300; } function f(c): uint8 { if (c) { return; } return anyv(); } f(1);')).toBe('TypeError');
});

test('the PARAMETER boundary is a different decision, and this is why', () => {
  // Recorded as a test rather than as a comment because it is the reason this
  // phase stops at two boundaries. A parameter annotation is shared by every
  // CALL SITE, and the checker cannot see them all: a function reached through
  // `apply`, through a builtin taking it as a callback, or through `eval` is
  // called from outside the source the checker walked. Deciding elision in the
  // callee on the evidence of the calls it can see would let those through.
  const f = 'function f(p: uint8) { return p is uint8; } ';
  expect(evaluated(`${f} String(f((5 := uint8)));`)).toBe('true');
  expect(thrownKind(`${f} f.apply(null, [300]);`)).toBe('RangeError');
  expect(thrownKind(`${f} [300].map(f);`)).toBe('RangeError');
  expect(thrownKind(`${f} eval("f(300)");`)).toBe('RangeError');
});

test('a callback takes its parameter types from the call site', () => {
  // The last piece of Phase 5, and machinery rather than a signature: a
  // function LITERAL takes its parameter types from the position it is written
  // in, so a callback learns the element type (F80). Asserted by rejection,
  // since a positive test passes against a checker that knows nothing.
  expectStatic('function nc(a: [].<uint8>) { a.forEach((x) => { let y: string = x; }); }');
  expectStatic('function nc(a: [].<uint8>) { a.map((x) => { let y: string = x; return 1; }); }');
  expectStatic('function nc(a: [].<uint8>) { a.filter((x) => { let y: string = x; return true; }); }');
  expect(evaluated('function nc(a: [].<uint8>) { a.forEach((x) => { let y: uint8 = x; }); } "ok";')).toBe('ok');
  // The INDEX is a `uint32` and the third parameter is the array itself, which
  // is what the signature says and what a reader would expect.
  expectStatic('function nc(a: [].<uint8>) { a.forEach((x, i) => { let y: string = i; }); }');
  expectStatic('function nc(a: [].<uint8>) { a.forEach((x, i, arr) => { let y: string = arr; }); }');
  // An ANNOTATION wins over the context, since the program said what it wanted.
  expect(evaluated('function nc(a: [].<uint8>) { a.forEach((x: uint8) => { let y: uint8 = x; }); } "ok";')).toBe('ok');
  // A BLOCK-bodied callback leaves `map` imprecise rather than wrong: its
  // return needs inference the checker does not have, so the result stays
  // ~any~ and nothing is claimed about it.
  expect(evaluated('function nc(a: [].<uint8>) { let b: [].<string> = a.map(x => { return 1; }); } "ok";')).toBe('ok');
  // An untyped receiver constrains nothing, and the run time is untouched.
  expect(evaluated('function nc(a) { a.forEach((x) => { let y: string = x; }); } "ok";')).toBe('ok');
  expect(evaluated('let a: [].<uint8> = [1,2]; let n = 0; a.forEach((x) => { n += 1; }); String(n);')).toBe('2');
});

test('an assignment invalidates a narrowing rather than being refused by it', () => {
  // sec-narrowing: "a narrowed binding is invalidated by an assignment that
  // leaves the narrowed type". The engine had the other behaviour - it checked
  // the assignment against the NARROWED type, so assigning a string to a
  // `uint8 | string` inside a branch that narrowed it to `uint8` was an error
  // (F78). That is the rule the clause states being enforced backwards: the
  // narrowing is a fact about the current value, and the assignment is what
  // ends it.
  expect(evaluated('function nc(x: uint8 | string) { if (x is uint8) { x = "s"; } } "ok";')).toBe('ok');
  expectStatic('function nc(x: uint8 | string) { if (x is uint8) { x = "s"; let y: uint8 = x; } }');
  // The narrowing holds up to the assignment, and the DECLARED type still
  // bounds what may be assigned.
  expect(evaluated('function nc(x: uint8 | string) { if (x is uint8) { let y: uint8 = x; x = "s"; } } "ok";')).toBe('ok');
  expectStatic('function nc(x: uint8 | string) { if (x is uint8) { x = true; } }');
  // An ordinary binding is unaffected in both directions.
  expect(evaluated('function nc() { let x: uint8 = 5; x = 7; } "ok";')).toBe('ok');
  expectStatic('function nc() { let x: uint8 = 5; x = "s"; }');
});

test('the short-circuit operators narrow, in the branch each one implies', () => {
  // `a && b` implies its left only where the whole is TRUE, and `a || b`
  // implies the left is false only where the whole is FALSE. Each narrows the
  // branch it implies and says nothing about the other (F77).
  expect(evaluated('function nc(x: uint8 | string) { if (x is uint8 && true) { let y: uint8 = x; } } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | string) { if (x is uint8 || false) { } else { let y: string = x; } } "ok";')).toBe('ok');
  expectStatic('function nc(x: uint8 | string) { if (x is uint8 && true) { } else { let y: uint8 = x; } }');
  // The RIGHT operand runs only where the left decided, so it sees the binding
  // narrowed - `x !== null && x.f` is the idiom this exists for.
  expect(evaluated('function nc(x: uint8 | string) { const r = x is uint8 && ((y: uint8) => y)(x); } "ok";')).toBe('ok');
  expect(evaluated('function nc(x: uint8 | string) { const r = x is uint8 || ((y: string) => y)(x); } "ok";')).toBe('ok');
});

test('a discriminant narrows the object, which is what makes a tagged union usable', () => {
  // `x.kind === "a"` over a union of records keeps the members whose `kind`
  // admits that literal. What narrows is the OBJECT, not the property (F77).
  const u = 'type A = { kind: "a", v: uint8 }; type B = { kind: "b", v: string }; ';
  expect(evaluated(`${u} function nc(x: A | B) { if (x.kind === "a") { let n: uint8 = x.v; } } "ok";`)).toBe('ok');
  expect(evaluated(`${u} function nc(x: A | B) { if (x.kind === "a") { } else { let s: string = x.v; } } "ok";`)).toBe('ok');
  // Each branch has the OTHER member's field type rejected, which is the
  // evidence that the union was actually filtered rather than widened away.
  expectStatic(`${u} function nc(x: A | B) { if (x.kind === "a") { let s: string = x.v; } }`);
  expectStatic(`${u} function nc(x: A | B) { if (x.kind === "a") { } else { let n: uint8 = x.v; } }`);
  // The run time is untouched.
  expect(evaluated(`${u} function f(x) { return x.kind === "a" ? "A" : "B"; } String(f({ kind: "a", v: 1 }));`)).toBe('A');
});

test('a test that can never succeed or never fail is dead code, where that is decidable', () => {
  // sec-narrowing: the branch such a test guards "is then dead code the program
  // did not intend". The checker had the rule and never reached it for a
  // BINDING (F76).
  expectStatic('function nc(x: uint8) { if (x is string) { } }');
  expectStatic('function nc(x: uint8) { if (x is uint8) { } }');
  // A genuine union test is not dead in either direction.
  expect(evaluated('function nc(x: uint8 | string) { if (x is uint8) { } } "ok";')).toBe('ok');
  // WHERE IT DOES NOT APPLY, and this is the part worth keeping: the rule
  // reasons from the static type, so it fires only where membership is a fact a
  // value cannot lose. An OBJECT type is checked at the boundary and not
  // afterwards, and a `where` predicate is re-evaluated on every test, so a
  // binding of either can stop satisfying its own declared type - the suite's
  // own dependent-record case proves it. Reporting those as dead branches would
  // contradict a documented behaviour.
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (5 := uint8) }; p.a = (0 := uint8); (p is Pos) ? "y" : "n";')).toBe('n');
  expect(evaluated('function nc(o: { a: uint8 }) { if (o is { a: uint8 }) { } } "ok";')).toBe('ok');
  // An OPTIONAL parameter includes `undefined`, so testing for it is a live
  // branch - the checker had the bare annotation, which this rule exposed.
  expect(evaluated('function g(a: uint8, b?: string) { return b === undefined ? "short" : "long"; } String(g((1 := uint8)));')).toBe('short');
});

test('the literal rule reaches equality and case labels', () => {
  // DECISION TAKEN by the proposal's author (F74): the literal rule covers
  // equality as it covers arithmetic, bitwise, shift, and relational
  // operators. A literal takes the other operand's type, so the comparison is
  // uint16 against uint16 rather than a typed value against a Number.
  expect(evaluated('String((65 := uint16) === 65);')).toBe('true');
  expect(evaluated('String(65 === (65 := uint16));')).toBe('true');
  expect(evaluated('String((65 := uint16) !== 65);')).toBe('false');
  expect(evaluated('const c = (65 := uint16); let r = "none"; switch (c) { case 65: r = "hit"; break; } r;')).toBe('hit');
  // R1 IS UNTOUCHED, and this is where it lives: a VARIABLE adopts nothing, so
  // it still asks whether a typed value and a Number are the same value.
  expect(evaluated('const n = 65; String((65 := uint16) === n);')).toBe('false');
  expect(evaluated('function anyv() { return 65; } String((65 := uint16) === anyv());')).toBe('false');
  expect(evaluated('String((65 := uint16) === (65 := uint8));')).toBe('false');
  // A literal the type cannot hold is simply not equal to any value of it - a
  // comparison asks a question, so it answers rather than throwing.
  expect(evaluated('String((65 := uint8) === 300);')).toBe('false');
  // A BIGINT literal does not adopt a Number-family type: a BigInt is a numeric
  // type of its own, and reading its payload as a Number was a host crash.
  expect(evaluated('String((5 := uint8) === 5n) + "/" + String((5 := uint8) == 5n);')).toBe('false/true');
  // What this buys, and what made the decision worth taking: a callback that
  // compares an element against a literal now works over a typed array, which
  // is the ordinary way to use one.
  expect(evaluated('let a: [].<uint16> = [65, 66]; String(a.find(x => x === 65));')).toBe('65');
  expect(evaluated('let a: [].<uint16> = [65, 66]; String(a.filter(x => x === 65).length);')).toBe('1');
  expect(evaluated('let a: [].<uint16> = [65]; String(a.some(x => x === 65)) + "/" + String(a.every(x => x === 65));')).toBe('true/true');
  // Untyped code is untouched, including the identity edges.
  expect(evaluated('String(65 === 65) + "/" + String("a" === "a") + "/" + String(NaN === NaN) + "/" + String(65n === 65);')).toBe('true/true/false/false');
  expect(evaluated('const o = {}; String(o === o) + "/" + String({} === {});')).toBe('true/false');
});

test('a typed Map takes its key and value positions at their declared types', () => {
  // The value position (F73), mirroring the Set element position.
  const m = 'let m: Map.<string, uint8> = new Map(); ';
  expect(evaluated(`${m} m.set("a", 65); String(m.get("a") is uint8);`)).toBe('true');
  // MIGRATED TO STATIC FORM, as the Set assertions above were, and for the
  // same reason.
  expectStatic(`${m} m.set("a", 300);`);
  expect(thrownKind(`${m} function anyv() { return 300; } m.set("a", anyv());`)).toBe('RangeError');
  expect(thrownKind(`${m} m.set("a", {});`)).toBe('TypeError');
  // And the KEY position, which is the same rule at index 0.
  const k = 'let k: Map.<uint8, string> = new Map(); ';
  expect(evaluated(`${k} k.set(65, "v"); String(k.get(65));`)).toBe('v');
  expect(evaluated(`${k} k.set(65, "v"); String(k.has(65)) + "/" + String(k.delete(65));`)).toBe('true/true');
  expectStatic(`${k} k.set(300, "v");`);
  expect(thrownKind(`${k} function anyv() { return 300; } k.set(anyv(), "v");`)).toBe('RangeError');
  // An untyped Map constrains nothing.
  expect(evaluated('const u = new Map(); u.set("a", 300); String(u.get("a"));')).toBe('300');
});

test('a collection constructed with type arguments carries them', () => {
  // `new Set.<uint8>()` writes its type arguments on the construction, and
  // nothing carried them to the object: the specialization form handles a
  // generic ALIAS and returns the plain constructor for a library generic, so
  // the collection came back unstamped and every method went unchecked. An
  // ANNOTATION made this unnecessary by stamping at the binding boundary
  // instead, which is why the common spelling worked and the direct one did
  // not (F73).
  expect(evaluated('const s = new Set.<uint8>(); s.add(65); String([...s][0] is uint8);')).toBe('true');
  expect(thrownKind('const s = new Set.<uint8>(); s.add(300);')).toBe('RangeError');
  expect(evaluated('const m = new Map.<string, uint8>(); m.set("a", 65); String(m.get("a") is uint8);')).toBe('true');
  expect(thrownKind('const m = new Map.<string, uint8>(); m.set("a", 300);')).toBe('RangeError');
  expect(evaluated('const m = new Map.<string, uint8>([["a", 65]]); String(m.get("a"));')).toBe('65');
  // A plain construction and an ordinary class are untouched.
  expect(evaluated('const u = new Set(); u.add(300); String(u.size);')).toBe('1');
  expect(evaluated('class K { constructor(x) { this.x = x; } } String(new K(5).x);')).toBe('5');
});

test('an EMPTY typed array carries its element type', () => {
  // An empty array satisfies any element type VACUOUSLY, so the membership
  // shortcut in the conversion returned it unchanged and it never acquired the
  // element type the store check reads. `let a: [].<uint8> = []` therefore
  // produced an array on which the entire typed surface was switched off -
  // for the most common way to build one (F71).
  expect(evaluated('let a: [].<uint8> = []; a.push(65); String(a[0] is uint8);')).toBe('true');
  expect(evaluated('let a: [].<uint8> = []; a[0] = 65; String(a[0] is uint8);')).toBe('true');
  // The build-a-list idiom end to end.
  expect(evaluated('let a: [].<uint8> = []; for (let i = (0 := uint8); i < (3 := uint8); i++) { a.push(i); } String(a.length) + "/" + String(a[2] is uint8);')).toBe('3/true');
  // And the checks it was missing now fire on it.
  expect(thrownKind('let a: [].<uint8> = []; function anyv() { return 300; } a[0] = anyv();')).toBe('RangeError');
  expect(evaluated('function f(a: [].<uint8>) { a.push(65); return a[0] is uint8; } String(f([]));')).toBe('true');
  // A non-empty one was always right, and an untyped array is untouched.
  expect(evaluated('let a: [].<uint8> = [1]; a.push(65); String(a[1] is uint8);')).toBe('true');
  expect(evaluated('const b = []; b.push(65); String(b[0] is uint8);')).toBe('false');
});

test('a typed collection takes its needle at the element type', () => {
  // A typed collection's search methods take the element type, which is the
  // design's own shape for one (`has(value: T)` on a `WeakSet<T>`). Without it
  // a correctly typed array could not find a literal it contains:
  // `a.includes(65)` was *false* on a `[].<uint16>` holding 65, in fully typed
  // code with no mixing anywhere (F68).
  const a = 'let a: [].<uint16> = [65, 66]; ';
  expect(evaluated(`${a} String(a.includes(65));`)).toBe('true');
  expect(evaluated(`${a} String(a.indexOf(66));`)).toBe('1');
  expect(evaluated(`${a} String(a.lastIndexOf(65));`)).toBe('0');
  expect(evaluated(`${a} String(a.includes(99));`)).toBe('false');
  // A needle the element type cannot hold is a TYPE ERROR, not a *false*
  // answer. An earlier draft answered *false*, reasoning that a search asks a
  // question with a perfectly good answer; that invented a search-versus-store
  // split the proposal does not have, and the proposal's own narrowing rule
  // settles it - "it is a type error to apply a narrowing form where the test
  // can never succeed... the branch it guards is then dead code the program did
  // not intend" (F69). A search is a parameter like any other, so it behaves
  // like one, and the store beside it reports the same way.
  // A LITERAL needle is caught statically, by the literal rule, because the
  // checker knows the method's signature (F70) - and the run-time check remains
  // the backstop for a needle whose type it cannot settle. Both paths asserted,
  // as they are for the element-store rows.
  expectStatic(`${a} a.includes(70000);`);
  expectStatic(`${a} a.includes("hello");`);
  expectStatic('let a2: [].<uint8> = [1]; a2.includes(1.5);');
  expectStatic(`${a} a.indexOf(70000);`);
  expectStatic(`${a} a.fill(70000);`);
  expect(thrownKind(`${a} function anyv() { return 70000; } a.includes(anyv());`)).toBe('RangeError');
  expect(thrownKind(`${a} function anyv() { return "hello"; } a.includes(anyv());`)).toBe('TypeError');
  // The store beside it reports identically, which is the point: there is no
  // search-versus-store split, only a parameter of a declared type.
  expect(thrownKind(`${a} function anyv() { return 70000; } a.push(anyv());`)).toBe('RangeError');
  // A typed needle works, and one of another family converts through the same
  // boundary rather than failing to match.
  expect(evaluated(`${a} const c = (65 := uint16); String(a.includes(c));`)).toBe('true');
  expect(evaluated(`${a} const c = (65 := uint8); String(a.includes(c));`)).toBe('true');
  expect(evaluated('let f: [].<float32> = [1.5]; String(f.includes(1.5));')).toBe('true');
  // An UNTYPED array is unchanged - it constrains nothing, so it answers rather
  // than throwing - and asking whether it contains a typed value is still
  // *false*, on the BigInt precedent the language already ships.
  expect(evaluated('const b = [65]; String(b.includes(70000)) + "/" + String(b.includes("hello"));')).toBe('false/false');
  expect(evaluated('const b = [65]; String(b.includes(65)) + "/" + String(b.includes((65 := uint16)));')).toBe('true/false');
  expect(evaluated('String([1n].includes(1));')).toBe('false');
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
  // Since F74 a literal adopts, so `a.length === 3` is *true* - one of the two
  // costs this test was pinning has been paid off by that decision. The
  // remaining cost is the comparison against a variable.
  expect(evaluated('let a: [].<uint8> = [1,2,3]; String(a.length === 3) + "/" + String(a.length == 3);')).toBe('true/true');
  expect(evaluated('let a: [].<uint8> = [1,2,3]; const n = 3; String(a.length === n);')).toBe('false');
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
