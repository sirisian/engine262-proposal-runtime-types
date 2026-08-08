import { test } from 'vitest';
import { expectBuilderTrue, expectBuilderThrows } from '../corpus/type-challenges/harness.mts';

/**
 * Phase 3 - Reflect.makeType and Reflect.isAssignable.
 * Source: proposal spec #sec-reflect-maketype, #sec-reflect-isassignable.
 *
 * isAssignable exposes the checker's IsAssignable judgment unchanged: the
 * conditional types of an erased system are written `Reflect.isAssignable(T, U)
 * ? X : Y` in a builder. makeType reads a structural node description and returns
 * the interned Type Object it describes; a Type Object anywhere in the node
 * contributes its record, so construction composes and canonicalizes. Identity
 * is `===` by interning, asserted alias-to-alias.
 */

// --- Reflect.isAssignable ---

test('isAssignable - a literal type is assignable to its base', () => {
  expectBuilderTrue(`
    type Lit = 'on';
    String(Reflect.isAssignable(Lit, string));
  `);
});

test('isAssignable - the base is not assignable to the literal', () => {
  expectBuilderTrue(`
    type Lit = 'on';
    String(Reflect.isAssignable(string, Lit) ? false : true);
  `);
});

test('isAssignable - reflexive', () => {
  expectBuilderTrue('String(Reflect.isAssignable(uint8, uint8));');
});

test('isAssignable - a union member is assignable to the union', () => {
  expectBuilderTrue(`
    type U = 'a' | 'b';
    type A = 'a';
    String(Reflect.isAssignable(A, U));
  `);
});

test('isAssignable - throws when an argument is not a Type Object', () => {
  expectBuilderThrows('Reflect.isAssignable(5, uint8);');
  expectBuilderThrows('Reflect.isAssignable(uint8, 5);');
});

// --- Reflect.makeType ---

test('makeType - a Type Object used as a node contributes its record', () => {
  expectBuilderTrue(`
    const T = Reflect.makeType(uint8);
    String(T === uint8);
  `);
});

test('makeType - builds a union that interns with the written form', () => {
  expectBuilderTrue(`
    type A = 'a';
    type B = 'b';
    const U = Reflect.makeType({ kind: 'union', arms: [A, B] });
    type Expected = 'a' | 'b';
    String(U === Expected);
  `);
});

test('makeType - canonicalizes (duplicate union arms collapse)', () => {
  expectBuilderTrue(`
    type A = 'a';
    const U = Reflect.makeType({ kind: 'union', arms: [A, A] });
    String(U === A);
  `);
});

test('makeType - builds an object that interns with the written form', () => {
  expectBuilderTrue(`
    const O = Reflect.makeType({
      kind: 'object',
      properties: [{ name: 'x', type: uint8, optional: false }],
      indexSignatures: [],
    });
    type Expected = { x: uint8 };
    String(O === Expected);
  `);
});

test('makeType - nests (a constructed type used inside another)', () => {
  expectBuilderTrue(`
    const Inner = Reflect.makeType({
      kind: 'object',
      properties: [{ name: 'v', type: uint8, optional: false }],
      indexSignatures: [],
    });
    const Outer = Reflect.makeType({
      kind: 'object',
      properties: [{ name: 'inner', type: Inner, optional: false }],
      indexSignatures: [],
    });
    type Expected = { inner: { v: uint8 } };
    String(Outer === Expected);
  `);
});

test('makeType - builds a tuple', () => {
  expectBuilderTrue(`
    const T = Reflect.makeType({
      kind: 'tuple',
      elements: [{ type: uint8, rest: false }, { type: string, rest: false }],
    });
    type Expected = [uint8, string];
    String(T === Expected);
  `);
});

test('makeType - builds an intersection', () => {
  expectBuilderTrue(`
    type A = { a: uint8 };
    type B = { b: string };
    const I = Reflect.makeType({ kind: 'intersection', members: [A, B] });
    type Expected = { a: uint8 } & { b: string };
    String(I === Expected);
  `);
});

test('makeType - builds a dynamic array', () => {
  expectBuilderTrue(`
    const A = Reflect.makeType({ kind: 'array', element: uint8, extent: undefined });
    type Expected = [].<uint8>;
    String(A === Expected);
  `);
});

test('makeType - builds a fixed-extent array', () => {
  expectBuilderTrue(`
    const A = Reflect.makeType({ kind: 'array', element: uint8, extent: 4 });
    type Expected = [4].<uint8>;
    String(A === Expected);
  `);
});

test('makeType - throws on an invalid node', () => {
  expectBuilderThrows("Reflect.makeType({ kind: 'bogus' });");
  expectBuilderThrows('Reflect.makeType(5);');
});

/*
 * Challenges these primitives unlock (builder-shaped ports). With makeType and
 * isAssignable, several challenges can now be expressed close to their corpus
 * builder form, constructing the result and asserting it with `===`.
 */

// 3312 - Parameters - the parameter list of a function type, as a tuple. The
// corpus builder reads node.signatures[0].parameters and calls
// Reflect.makeType({ kind: 'tuple', elements: ... }). Reflection accessors are
// Phase 3+ (getReflection is not yet in the engine), but the CONSTRUCTION half
// is now expressible: makeType builds the parameter tuple, which interns with
// the written tuple type.
test('challenge 3312 - Parameters (construction via makeType)', () => {
  expectBuilderTrue(`
    const Params = Reflect.makeType({
      kind: 'tuple',
      elements: [{ type: string, rest: false }, { type: uint32, rest: false }],
    });
    type Expected = [string, uint32];
    String(Params === Expected);
  `);
  // the empty parameter list. NOTE: there is no empty-tuple SYNTAX: `[]` parses
  // as a dynamic array ([].<any>), not an empty tuple, so the empty tuple is
  // only reachable through construction. Two constructed empty tuples intern
  // together, which is the identity the empty-parameter case turns on.
  expectBuilderTrue(`
    const Params = Reflect.makeType({ kind: 'tuple', elements: [] });
    const Same = Reflect.makeType({ kind: 'tuple', elements: [] });
    String(Params === Same);
  `);
});

// 268 - If - the condition branch is Reflect.isAssignable(C, boolean). With
// isAssignable the guard the builder uses is now directly expressible.
test('challenge 268 - If (condition guard via isAssignable)', () => {
  // a boolean condition passes the guard; a non-boolean fails it
  expectBuilderTrue(`
    type C = boolean;
    String(Reflect.isAssignable(C, boolean));
  `);
  expectBuilderTrue(`
    type C = 'a';
    String(Reflect.isAssignable(C, boolean) ? false : true);
  `);
});

// 898 - Includes - interning IS identity, so the membership test is `.some(e =>
// e.type === U)`. The identity core is testable directly; isAssignable is the
// distinct relation the corpus note contrasts with `===`.
test('challenge 898 - Includes (identity vs assignability are distinct)', () => {
  // 'Kars' === 'Kars' by interning (the membership verdict)
  expectBuilderTrue(`
    type Element = 'Kars';
    type Query = 'Kars';
    String(Element === Query);
  `);
  // identity and assignability differ: 'Kars' is assignable to string, but not
  // identical to it. The corpus's whole point about `===` vs isAssignable.
  expectBuilderTrue(`
    type Lit = 'Kars';
    String(Reflect.isAssignable(Lit, string) && !(Lit === string));
  `);
});
