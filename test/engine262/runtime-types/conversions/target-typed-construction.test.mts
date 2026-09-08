import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Spec: sec-new-expressions, `new` `.` Arguments.
//
// Target-typed construction: it constructs the type its POSITION requires, so
// the type is not named. The checker resolves the contextual type and records
// it, because the runtime has no contextual type of its own and the annotation
// is enforced only after a value exists - too late for a form whose job is
// deciding what to construct.

test('the type comes from the position', () => {
  expect(evaluated('class A { constructor(x, y) { this.v = x + y; } } const a: A = new.(10, 20); String(a.v);')).toBe('30');
  expect(evaluated('class A { constructor(x, y) { this.v = x + y; } } const a: [].<A> = [new.(10, 20), new.(30, 40)]; String(a[1].v);')).toBe('70');
  expect(evaluated('class A { constructor(x, y) { this.v = x + y; } } function g(): A { return new.(3, 4); } String(g().v);')).toBe('7');
  // Nesting: the inner position's type is the outer constructor's parameter.
  expect(evaluated('class B { constructor(n) { this.n = n; } } class A { constructor(b) { this.v = b.n; } } const a: A = new.(new B(7)); String(a.v);')).toBe('7');
});

test('it composes with a converting constructor in one literal', () => {
  // README's mixed example: explicit construction beside a bare element that
  // converts through the one-parameter constructor. Needs both features.
  expect(evaluated('class A { constructor(x: uint32) { this.v = Number(x); } } const a: [].<A> = [new.(9), 5]; String(a[0].v) + "/" + String(a[1].v);')).toBe('9/5');
});

test('the two refusals the clause names', () => {
  // "a position that requires no type gives nothing to construct" - a Syntax
  // Error rather than an inference, because inferring would be the binding-type
  // inference this proposal does not perform.
  expectThrown('const a = new.(1);');
  // And a contextual type that cannot be constructed.
  expectThrown('let n: uint8 = new.(1);');
});

test('the forms sharing this production are unchanged', () => {
  // `new.target`, ordinary `new` with a parenthesized callee, and placement
  // `new` all parse through the same production this form joins.
  expect(evaluated('function f() { return String(new.target); } f();')).toBe('undefined');
  expect(evaluated('class A { constructor() { this.k = "A"; } } const a = new(A); String(a.k);')).toBe('A');
  expect(evaluated('function F() { return new.target !== undefined; } String(new F() instanceof F);')).toBe('true');
});

test('an argument position carries a contextual type', () => {
  // This was pinned as an expected failure. The cause was not in this feature at
  // all: `declareFunctionSignatures` resolved parameter annotations before any
  // class name was collected, so a class-typed parameter fell back to `any` -
  // and a contextual type of `any` is indistinguishable from none. Collecting
  // class names first fixed this and gave class-typed parameters compile-time
  // checking at their call sites, which they had never had.
  expect(evaluated('class A { constructor(x, y) { this.v = x + y; } } function f(p: A) { return p.v; } String(f(new.(1, 2)));')).toBe('3');
  expect(evaluated('class A { constructor(x) { this.v = x; } } function f(p: A) { return p.v; } String(f(new.(7)));')).toBe('7');
});

test('the target may be any CONSTRUCTIBLE type, not only a class', () => {
  // #sec-new-expressions: "It is a type error where the contextual type is not
  // CONSTRUCTIBLE, as in `let n: uint8 = new.(1)`" - constructible, not nominal.
  // The form was class-only, and the design's own examples build an array and a
  // vector this way: "Since this works for any type the following works as
  // well", over `[].<float32x4>`.
  expect(evaluated('let a: float32x4 = new.(1, 2, 3, 4); String(a[0]);')).toBe('1');
  expect(evaluated('let a: [].<float32x4> = [new.(1,2,3,4), new.(1,2,3,4)]; String(a.length);')).toBe('2');
  expect(evaluated('function g(v: float32x4) { return 1; } String(g(new.(1, 2, 3, 4)));')).toBe('1');
  // A class target is unchanged.
  expect(evaluated('class C { x: uint8 = 0; } let c: C = new.(); String(Number(c.x));')).toBe('0');

  // An ARRAY is filled with its element's default, which is what the written
  // form does: `new [4].<uint8>()` and `new [4].<uint8>(1,2,3,4)` both give
  // `0,0,0,0`, the same value a bare declaration holds. The two spellings of one
  // construction must not differ.
  expect(evaluated('let a: [4].<uint8> = new.(); String(a.join(","));')).toBe('0,0,0,0');
  expect(evaluated('const a = new [4].<uint8>(); String(a.join(","));')).toBe('0,0,0,0');
  expect(evaluated('let a: [4].<uint8>; String(a.join(","));')).toBe('0,0,0,0');
});

test('a target that is NOT constructible says so', () => {
  // The message used to be `report(contextual, contextual)`, which claimed a type
  // was not assignable to ITSELF - `"vector.<float32, 4>" is not assignable to
  // "vector.<float32, 4>"` - for every target the form did not support. A type
  // failing to be assignable to itself is a claim a reader has to disprove
  // before they can see what was meant.
  expectThrown('let n: uint8 = new.(1);', 'is not constructible');
  expectThrown('let s: string = new.();', 'is not constructible');
  // And a position with no contextual type at all still says THAT, which is a
  // different mistake and keeps its own message.
  expectThrown('const x = new.();', 'requires a contextual type');
});

test('a type named by a BINDING is a target too', () => {
  // A type may be named by an ordinary binding holding a type object, and the
  // checker does not resolve those - `const MyT = uint8; let a: MyT = "s"` is a
  // runtime TypeError where `let a: uint8 = "s"` is a static one. Every other
  // spelling copes, because the binding boundary resolves the annotation when
  // the declaration evaluates. `new.()` did not, being the one construct that
  // needs its type BEFORE the value exists, so a valid program was refused
  // statically with a message about a contextual type the position HAD.
  expect(evaluated('class C { x: uint8 = 0; } const MyT = C;'
    + ' let a: MyT = new.(); String(Number(a.x));')).toBe('0');
  // Including one introduced at runtime, which is why absence can never be
  // proved at check time and why the refusal could not have been made correct by
  // resolving harder.
  expect(evaluated('class C { x: uint8 = 0; } globalThis.MyT = C;'
    + ' let a: MyT = new.(); String(Number(a.x));')).toBe('0');
  // A `type` alias resolves statically and always worked; it is the pair with
  // the line above that shows the two kinds of name apart.
  expect(evaluated('class C { x: uint8 = 0; } type MyT = C;'
    + ' let a: MyT = new.(); String(Number(a.x));')).toBe('0');

  // The Syntax Error is kept for what it is about: nothing written for the
  // runtime to resolve.
  expectThrown('const x = new.();', 'requires a contextual type');
  // ...and a written annotation that IS resolvable still decides constructibility.
  expectThrown('let n: uint8 = new.(1);', 'is not constructible');
});

test('an annotation that names nothing reports the NAME', () => {
  // A regression, and its cause was not where the change that exposed it was
  // made. `LexicalDeclaration` resolves the annotation to give the initializer a
  // contextual type, and took `.Value` from the completion unconditionally -
  // which on a THROW completion is the error object. A `ReferenceError` was
  // pushed as the contextual type, and `new.()` read it and reported
  // "undefined is not assignable to undefined": a message naming neither the
  // annotation nor the construct.
  //
  // Every other spelling of this mistake already reported the name, which is the
  // agreement this restores rather than a phase chosen for `new.()`.
  expectThrown('let a: Nope = new.();', '"Nope" is not defined');
  expectThrown('let a: Nope = 5;', '"Nope" is not defined');
  expectThrown('let a: Nope = float32x4(1, 2, 3, 4);', '"Nope" is not defined');
  expectThrown('let a: Nope;', '"Nope" is not defined');
  expectThrown('function f(x: Nope) { return 1; } f(1);', '"Nope" is not defined');
});

test('the genuinely contextless form keeps its own message', () => {
  // The Syntax Error is about a position that requires NO type, and propagating
  // an annotation's failure must not swallow it: here nothing was written for the
  // runtime to resolve.
  expectThrown('const x = new.();', 'requires a contextual type');
});

test('a resolvable annotation still constructs, however the type is named', () => {
  // The four rows the change that caused the regression existed for. They must
  // pass UNEDITED - if propagating the annotation's error reached these, it went
  // further than intended.
  const C = 'class C { x: uint8 = 0; } ';
  expect(evaluated(`${C} let a: C = new.(); String(Number(a.x));`)).toBe('0');
  expect(evaluated(`${C} const MyT = C; let a: MyT = new.(); String(Number(a.x));`)).toBe('0');
  expect(evaluated(`${C} globalThis.MyT2 = C; let a: MyT2 = new.(); String(Number(a.x));`)).toBe('0');
  expect(evaluated(`${C} type Alias = C; let a: Alias = new.(); String(Number(a.x));`)).toBe('0');
  // ...and the constructibility rule is orthogonal to all of it.
  expectThrown('let n: uint8 = new.(1);', 'is not constructible');
  expect(evaluated('let a: [4].<uint8> = new.(); String(a.join(","));')).toBe('0,0,0,0');
  expect(evaluated('let v: float32x4 = new.(1, 2, 3, 4); String(v[0]);')).toBe('1');
});
