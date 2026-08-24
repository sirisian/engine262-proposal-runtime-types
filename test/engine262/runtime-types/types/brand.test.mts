import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * proposal-runtime-types `sec-parameterized-types`, PLAN-brand.md phase 3.
 *
 * A brand is a `parameterized` type whose meta type declares NO validation,
 * which is what makes it a brand: "a brand, whose meta type defines no
 * validation, therefore admits no bare value of its base except through the
 * construction boundary, which is the point of a brand."
 *
 * The plan states twelve obligations and this file is the exhaustive check of
 * them. Where a test asserts something the plan's first draft got wrong, the
 * correction is in the comment - three of them are, and each was corrected by
 * measuring rather than by reasoning.
 */

/** `U` throughout: a branded `uint32`. */
const U = "type U = uint32.<{ brand: 'UserId' }>; ";
/** A second brand over the same base, for the crossing tests. */
const O = "type O = uint32.<{ brand: 'OrderId' }>; ";

// ---------------------------------------------------------------------------
// Identity and interning (B1, B2)
// ---------------------------------------------------------------------------

test('B1: a brand is distinguished by its tag and by its base', () => {
  expect(evaluated(`${U}${O}String(U !== O);`)).toBe('true');
  expect(evaluated("String(type uint32.<{ brand: 'X' }> !== type uint64.<{ brand: 'X' }>);")).toBe('true');
});

test('B2: the same brand written twice is one type, with no registry', () => {
  // typeprogramming.md 6.5: "one type everywhere it is written, in any module,
  // without a registry". Structural interning delivers it - the tag is part of
  // the metadata and the metadata is part of the type's identity.
  expect(evaluated(`${U}String(U === type uint32.<{ brand: 'UserId' }>);`)).toBe('true');
});

test('B2: the builder and the syntax agree', () => {
  // The two spellings must be ONE type. They reach the interning table by
  // different routes - `makeType` from a node, and the parameterization syntax
  // through the checker - so agreeing is a property rather than a tautology.
  //
  // Spelled with `makeType` directly rather than through `std:types`, since
  // this harness evaluates SCRIPTS and the kit is a module. The kit's `brand`
  // is a one-line forwarder to exactly this call.
  expect(evaluated(`${U}const built = Reflect.makeType({ kind: 'parameterized', base: uint32,`
    + " metadata: { brand: 'UserId' } }); String(built === U);")).toBe('true');
});

test('F151: a nested brand REPLACES the outer tag rather than nesting', () => {
  // RECORDED, NOT FIXED. The plan's test 6 expected
  // `brand(brand(uint32,'A'),'B')` to be a distinct type from either, shedding
  // one layer at a time. It is not: parameterizing an already-branded type
  // MERGES the metadata, and a second `brand` key overwrites the first.
  //
  //   type N = U.<{ brand: 'Inner' }>;
  //   N === U                                  // true
  //   getReflection(N).metadata.brand          // 'UserId', not 'Inner'
  //
  // Whether that is right is a design question: merging is the documented
  // behaviour for metadata generally - a pattern and a range compose on one
  // base - and `brand` is the one key where composing means overwriting. A
  // brand over a brand may be meaningless (a value is one thing), or it may be
  // the natural way to say "a UserId that is also an AdminId". The clause does
  // not say.
  expect(evaluated(`${U}type N = U.<{ brand: 'Inner' }>; String(N === U);`)).toBe('true');
  expect(evaluated(`${U}type N = U.<{ brand: 'Inner' }>;`
    + " String(Reflect.getReflection(N).metadata.brand);")).toBe('UserId');
});

// ---------------------------------------------------------------------------
// The branding rule (B3, B4)
// ---------------------------------------------------------------------------

test('B3: a brand sheds to its base at a boundary', () => {
  // "the brand is shed freely on the way up". A boundary is where a DECLARED
  // type says what is wanted, and that is where shedding applies - see OQ3 for
  // why an operator is not a boundary.
  expect(evaluated(`${U}function f(n: uint32) { return n; }`
    + ' String(f(U((7 := uint32))));')).toBe('7');
  expect(evaluated(`${U}let n: uint32 = U((7 := uint32)); String(n);`)).toBe('7');
  expect(evaluated(`${U}String(Reflect.isAssignable(U, uint32));`)).toBe('true');
});

test('B4: the base is not assignable to the brand', () => {
  // "the base is not a subtype of the parameterization, so the way down is a
  // crossing". This is the half that makes a brand worth having.
  expect(evaluated(`${U}String(Reflect.isAssignable(uint32, U));`)).toBe('false');
});

test('B9: two brands over one base do not cross', () => {
  expect(evaluated(`${U}${O}String(Reflect.isAssignable(U, O));`)).toBe('false');
  expect(evaluated(`${U}${O}String(Reflect.isAssignable(O, U));`)).toBe('false');
  expectThrown(`${U}${O}function f(o: O) { return o; } f(U((7 := uint32)));`);
});

// ---------------------------------------------------------------------------
// The construction boundary (B5, B11) - the gate
// ---------------------------------------------------------------------------

test('B5 and B11 together: construction admits, a bare value does not', () => {
  // THE GATE. Either half alone is a different feature: B11 without B5 is a
  // type nothing can inhabit, and B5 without B11 is a checker-only fiction.
  //
  // This pair is what OQ1 turned on. A brand's meta type defines no `validate`,
  // and the boundary must read that as "no judgment to run" while the ordinary
  // membership test reads it as "admits nothing" - the same absence meaning
  // opposite things in the two places, deliberately.
  expect(evaluated(`${U}String(U((7 := uint32)));`)).toBe('7');
  expectThrown(`${U}function f(n: uint32) { let x: U = n; return x; } f((7 := uint32));`);
});

test('B5: the construction still requires the base', () => {
  // A crossing supplies metadata, not a different primitive.
  expectThrown(`${U}U('x');`);
});

test('B11: a pattern validates at the same boundary where a brand admits', () => {
  // The asymmetry stated as a contrast, because it is the whole of OQ1: the
  // boundary runs the DEFINED judgments. A pattern defines one and it decides;
  // a brand defines none and there is nothing to decide.
  expect(evaluated("type P = string.<{ pattern: /^a+$/ }>; String(P('aa'));")).toBe('aa');
  expectThrown("type P = string.<{ pattern: /^a+$/ }>; P('zz');");
});

// ---------------------------------------------------------------------------
// Representation (B6, B7) - three of these were corrected by measurement
// ---------------------------------------------------------------------------

test('B6: no wrapper object', () => {
  // B6 is an ALLOCATION claim and only that. The plan's first draft said a
  // branded value "IS its base value"; it is not - see the next test.
  expect(evaluated(`${U}String(typeof U((7 := uint32)));`)).toBe('number');
});

test('B6 corrected: a branded value is NOT identical to its base value', () => {
  // Test 18 as written asserted `UserId(7) === 7`. Measured, it is false: the
  // value carries its brand as its type, so it is a `uint32.<{brand}>` and not
  // a bare `uint32`.
  //
  // That is OQ2 and OQ3 working rather than a defect. A value that were
  // identical to its base could not report its brand from `Reflect.typeOf`, and
  // could not refuse to mix with a bare `uint32` - both of which a brand must
  // do. The allocation claim survives; the identity claim never held.
  expect(evaluated(`${U}String(U((7 := uint32)) === (7 := uint32));`)).toBe('false');
  expect(evaluated(`${U}String(U((7 := uint32)) === U((7 := uint32)));`)).toBe('true');
});

test('B7 corrected: a brand is preserved through an operator, not shed', () => {
  // Test 20 as written expected `UserId(7) + 1` to be a `uint32` - the brand
  // shedding through the operator. The engine does the opposite and it is
  // right (OQ3-B):
  //
  //   U + U      stays a U      - arithmetic WITHIN a type
  //   U + base   is a TypeError - the mixed expression a brand exists to catch
  //
  // Under the shedding rule those two would produce the SAME type, so the
  // operator would erase exactly the distinction the brand was for.
  expect(evaluated(`${U}String(U((7 := uint32)) + U((1 := uint32)));`)).toBe('8');
  expect(evaluated(`${U}String(Reflect.typeOf(U((7 := uint32)) + U((1 := uint32))) === U);`)).toBe('true');
  expectThrown(`${U}U((7 := uint32)) + (1 := uint32);`);
});

test('B7: an explicit conversion is how a caller opts out', () => {
  // The escape hatch, and it is deliberate: shedding at an operator is
  // WRITTEN rather than implicit.
  expect(evaluated(`${U}String((U((7 := uint32)) := uint32) + (1 := uint32));`)).toBe('8');
});

// ---------------------------------------------------------------------------
// Reflection and round trip (B10, OQ2)
// ---------------------------------------------------------------------------

test('B10: a brand round-trips through reflection', () => {
  expect(evaluated(`${U}String(Reflect.makeType(Reflect.getReflection(U)) === U);`)).toBe('true');
});

test('B10: the node carries base and metadata', () => {
  expect(evaluated(`${U}String(Reflect.getReflection(U).kind);`)).toBe('parameterized');
  expect(evaluated(`${U}String(Reflect.getReflection(U).base === uint32);`)).toBe('true');
  expect(evaluated(`${U}String(Reflect.getReflection(U).metadata.brand);`)).toBe('UserId');
});

test('OQ2: `Reflect.typeOf` reports the brand, not the base', () => {
  // The plan's first draft predicted the base, reasoning that a branded value
  // has nothing to read a brand from. It has: the value carries its type.
  // Reflection reports what a value IS - the principle
  // PLAN-callable-reflection.md settled - and a branded 7 is a UserId.
  expect(evaluated(`${U}String(Reflect.typeOf(U((7 := uint32))) === U);`)).toBe('true');
  expect(evaluated(`${U}String(Reflect.typeOf(U((7 := uint32))) === uint32);`)).toBe('false');
});

// ---------------------------------------------------------------------------
// Interaction with the rest of the language (B12)
// ---------------------------------------------------------------------------

test('B12: a brand composes as a property, an element and a parameter', () => {
  expect(evaluated(`${U}type R = { id: U }; const r: R = { id: U((7 := uint32)) }; String(r.id);`)).toBe('7');
  expect(evaluated(`${U}type T = [U, string]; const t: T = [U((7 := uint32)), 'a']; String(t[0]);`)).toBe('7');
  expect(evaluated(`${U}function f(u: U) { return u; } String(f(U((7 := uint32))));`)).toBe('7');
});

test('B12: a non-branded value is refused at each of those positions', () => {
  expectThrown(`${U}type R = { id: U }; function g(n: uint32) { const r: R = { id: n }; return r; } g((7 := uint32));`);
  expectThrown(`${U}function f(u: U) { return u; } function g(n: uint32) { return f(n); } g((7 := uint32));`);
});

test('F152: a union of a brand with its own base collapses to the base', () => {
  // RECORDED, NOT FIXED, and the plan flagged it in advance: "in a union:
  // `brand(uint32,'A') | uint32` - does it collapse to `uint32`? It must not."
  // It does.
  //
  //   type U | uint32 === uint32        // true
  //
  // The union rule drops a member a preceding one is a supertype of, and a
  // brand IS assignable to its base (B3), so the brand is absorbed. That is
  // consistent with how unions treat subtypes generally - and it means a
  // signature written `U | uint32` silently accepts any `uint32`, which is
  // very likely not what its author meant.
  //
  // Two brands over one base do NOT collapse, because neither is assignable to
  // the other, so the failure is confined to a union naming the base as well.
  expect(evaluated(`${U}String(type U | uint32 === uint32);`)).toBe('true');
  expect(evaluated(`${U}${O}String(Reflect.getReflection(type U | O).kind);`)).toBe('union');
});

test('B12: a brand over a string base behaves the same way', () => {
  // The rule is not special to numbers. A String base carries no
  // TypedNumberValue, so this checks that branding does not depend on one.
  const S = "type S = string.<{ brand: 'Name' }>; ";
  expect(evaluated(`${S}String(S('x'));`)).toBe('x');
  expect(evaluated(`${S}String(Reflect.isAssignable(S, string));`)).toBe('true');
  expect(evaluated(`${S}String(Reflect.isAssignable(string, S));`)).toBe('false');
  expectThrown(`${S}function f(s: string) { let x: S = s; return x; } f('x');`);
});

test('B12: a generic bound accepts the brand and refuses the base', () => {
  expect(evaluated(`${U}function f<T: U>(v: T) { return v; } String(f(U((7 := uint32))));`)).toBe('7');
  expectThrown(`${U}function f<T: U>(v: T) { return v; } function g(n: uint32) { return f(n); } g((7 := uint32));`);
});
