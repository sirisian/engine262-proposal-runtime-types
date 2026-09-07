import { test, expect } from 'vitest';
import { evaluated, expectError, expectThrown, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

/**
 * Spec: #sec-typed-destructuring (Typed Destructuring) - the optional
 * marker, the refusal of `ref` beside it, and a typed rest.
 */

test('an optional member binds undefined where the property is absent', () => {
  // the marker says the value may not be there, which is the rule an optional
  // PARAMETER already follows; it was parsed and then ignored here, so the
  // annotation was enforced against the absent property's undefined
  expect(evaluated('let o = {}; let { (x?: uint8) } = o; String(typeof x);')).toBe('undefined');
  // a supplied value is still enforced
  expect(evaluated('let o = { x: 1 }; let { (x?: uint8) } = o; String(x);')).toBe('1');
  expectThrown('let o = { x: "s" }; let { (x?: uint8) } = o;');
  // and a member that is NOT optional still requires its property
  expectThrown('let o = {}; let { (x: uint8) } = o;');
});

test('a ref parameter or member may not be optional', () => {
  // `?` says the argument may be omitted; a `ref` binds a LOCATION that an
  // omitted argument does not supply, so the pairing could never be honoured -
  // the same reason a `ref` parameter may not have a default
  expectError('function f(ref a?: uint32) { return 1; } "ran";');
  expectError('let o = { x: 1 }; let { (ref x?) } = o; "ran";');
  // the forms either half admits are unaffected
  expect(evaluated('function f(ref a: uint32) { return a; } let v = (7 := uint32); String(f(ref v));')).toBe('7');
  expect(evaluated('let o = { x: 1 }; let { (ref x) } = o; x = 5; String(o.x);')).toBe('5');
  expect(evaluated('function f(a?: uint32) { return typeof a; } String(f());')).toBe('undefined');
  // and a ref parameter still may not carry a default
  expectError('function f(ref a: uint32 = 1) { return a; } "ran";');
});

test('an object rest may state the type of what it collects', () => {
  // the rest is where a payload's unmodelled remainder goes, and was the one
  // position in a pattern that could not be typed
  expect(evaluated('let { (a: uint8), ...rest: object } = { a: 1, z: 2 }; String(rest.z);')).toBe('2');
  expect(evaluated('function f({ (a: uint8), ...rest: object }) { return rest.z; } String(f({ a: 1, z: 9 }));')).toBe('9');
  // the annotation is the type of the COLLECTION, so a member type is refused
  expectThrown('let { ...rest: uint8 } = { z: 2 };');
  // an untyped rest, and the array form, are unaffected
  expect(evaluated('let { a, ...rest } = { a: 1, z: 2 }; String(rest.z);')).toBe('2');
  expect(evaluated('let [a: uint8, ...b: [].<uint8>] = [1, 2, 3]; String(b.length);')).toBe('2');
});

// -- ref in a destructuring assignment -------------------------------------------

/**
 * A `ref` member of a destructuring ASSIGNMENT pattern (spec
 * #sec-typed-destructuring).
 *
 * The declaration form binds a new `ref`; this re-borrows one that already
 * exists, pointing it at the property's location on the object being
 * destructured. Assignment destructuring is the only form whose targets already
 * exist, which is what makes it worth having.
 *
 * Only `ref` is admitted here. An annotation types a NEW binding, and an
 * assignment creates none - the target already carries whatever type it was
 * declared at, so an annotation would be a second type for one target. `is` and
 * `:=` express a check.
 */

test('a ref member re-borrows an existing binding', () => {
  expect(evaluated('let o = { x: 1 }; let ref x = o.x; ({ (ref x) } = o); x = 5; String(o.x);')).toBe('5');
  // with a rename, so the binding and the property may differ
  expect(evaluated('let o = { x: 1 }; let ref r = o.x; ({ (ref r): x } = o); r = 7; String(o.x);')).toBe('7');
});

test('re-borrowing in a loop is what the form is for', () => {
  // one binding, retargeted at each row: the case a single `ref r = row.value`
  // cannot express without declaring inside the loop
  expect(evaluated('const rows = [{ value: 1 }, { value: 2 }]; let ref cursor = rows[0].value;'
    + ' for (const row of rows) { ({ (ref cursor): value } = row); cursor += 10; }'
    + ' String(rows[0].value) + "," + String(rows[1].value);')).toBe('11,12');
});

test('the parenthesized member of an object literal is unaffected', () => {
  // `{ (a: uint8): 1 }` is a TYPED OWN PROPERTY and already meant something, so
  // the two forms are told apart by the token after the parenthesis
  expect(evaluated('let o = { (a: uint8): 1 }; String(Number(o.a));')).toBe('1');
  expectThrown('let o = { (a: uint8): 1 }; o.a = 300;');
});

test('what a ref member refuses', () => {
  // an annotation in an assignment position
  expectThrown('let a; ({ (a: uint8) } = { a: 1 });');
  // a target that is not a ref binding has no borrow to retarget
  expectThrown('let plain = 1; let o = { x: 1 }; ({ (ref plain): x } = o);');
  // and a primitive has no property location to borrow
  expectThrown('let ref r = ({ x: 1 }).x; ({ (ref r): x } = 5);');
});

test('the declaration form and plain destructuring are unchanged', () => {
  expect(evaluated('let o = { x: 1 }; let { (ref x) } = o; x = 5; String(o.x);')).toBe('5');
  expect(evaluated('let a; ({ a } = { a: 1 }); String(a);')).toBe('1');
  expect(evaluated('let a, b; [a, b] = [1, 2]; String(a) + "," + String(b);')).toBe('1,2');
  expect(evaluated('const o = { a: 1, b: 2 }; String(o.a + o.b);')).toBe('3');
});

// ---------------------------------------------------------------------------
// A DESTRUCTURING MEMBER'S ANNOTATION IS THE BOUND NAME'S STATIC TYPE.
//
// `#sec-typed-destructuring`: "`{ (a: uint8) }` binds `a` to the value of
// property `a`, ENFORCED AT THAT BINDING AS AN ANNOTATED DECLARATION IS". It was
// so enforced at run time - a wrong-typed value is refused at the binding, and
// `v is uint8` holds afterwards - but the checker recorded no type for the name,
// so `let s: string = v` was accepted where the same annotation on a plain `let`
// is refused. The declaration arm handled a BindingIdentifier and fell through
// for a BindingPattern, declaring nothing.
//
// Found while fixing the ref-binding gap, and initially mis-scoped as a `ref`
// issue: the `ref` is irrelevant, and a plain `{ (v: uint8) }` had it too.
// ---------------------------------------------------------------------------

test('an annotated destructuring member is checked like an annotated declaration', () => {
  expectStaticTypeError('let { (v: uint8) } = { v: 1 }; let s: string = v;');
  // The rename form binds the name after the colon.
  expectStaticTypeError('let { (v: uint8): b } = { v: 1 }; let s: string = b;');
  // An optional member, and a `ref` member, carry their annotations the same way.
  expectStaticTypeError('let { (v?: uint8) } = { v: 1 }; let s: string = v;');
  expectStaticTypeError('class C { v: uint8 = 0; } const c = new C(); let { (ref v: uint8) } = c; let s: string = v;');
  // At any depth.
  expectStaticTypeError('let { a: { (v: uint8) } } = { a: { v: 1 } }; let s: string = v;');
  // The control the rule is stated against.
  expectStaticTypeError('let v: uint8 = 1; let s: string = v;');
});

test('what the annotation does not change', () => {
  // A use that fits goes through, and the value is of the annotated type - the
  // run-time half, which was already right.
  expect(evaluated('let { (v: uint8) } = { v: 1 }; let u: uint8 = v; String(u) + " " + String(v is uint8);')).toBe('1 true');
  // A member with no annotation is left to the source's shape, as before.
  expect(ok('let { v } = { v: 1 }; let s: string = v;')).toBe(true);
  // The run-time enforcement at the binding is unchanged.
  expectThrownKind('function g() { return "s"; } let { (v: uint8) } = { v: g() };', 'TypeError');
});
