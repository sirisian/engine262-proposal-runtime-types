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
