import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * F190. `TypeArguments` attached to a
 * |TypeName| and once, so every type that was not a bare NAME could not be
 * parameterized inline - and each could be the moment it was given a name,
 * which made the rule turn on whether a type had been named.
 *
 * `PostfixType : PostfixType TypeArguments` is the same shape
 * `IndexedAccessType` already had, so the two now compose in either order.
 *
 * Every "now parses" test is paired with an `===` against its alias spelling.
 * That pairing is the point: it proves the change adds SYNTAX and not
 * semantics, which is the one way a grammar change of this kind goes wrong
 * unnoticed.
 */

// --- The six operand shapes ------------------------------------------------

test('a parameterized type can be parameterized again', () => {
  expect(evaluated("type N = string.<{ brand: 'E' }>.<{ brand: 'N' }>;"
    + ' String(Reflect.getReflection(N).kind);')).toBe('parameterized');
  expect(evaluated("type N = string.<{ brand: 'E' }>.<{ brand: 'N' }>;"
    + " type E = string.<{ brand: 'E' }>; type M = E.<{ brand: 'N' }>; String(N === M);")).toBe('true');
});

test('an array can be parameterized', () => {
  // The sharpest case: `ArrayOrTupleType : [ ] TypeArguments` spends its ONE
  // slot on the element type, so the restriction here was structural.
  expect(evaluated("type T = [].<uint8>.<{ brand: 'B' }>;"
    + ' String(Reflect.getReflection(T).kind);')).toBe('parameterized');
  // F191, FIXED. The inline form built its base as an intermediate record and
  // never asked for a Type Object, so nothing was interned for it - and a later
  // `type A = [].<uint8>` bound to the only Type Object whose record matched
  // closely enough, this parameterization's, so `A` reported the brand.
  //
  // It showed only for arrays, only inline, and only when the bare alias came
  // AFTERWARDS: declaring `A` first gave the array a Type Object of its own.
  // Interning the base fixes it in both orders.
  expect(evaluated("type T = [].<uint8>.<{ brand: 'B' }>;"
    + " type A = [].<uint8>; type U = A.<{ brand: 'B' }>; String(T === U);")).toBe('true');
  expect(evaluated("type T = [].<uint8>.<{ brand: 'B' }>;"
    + " type A = [].<uint8>; String(T === A);")).toBe('false');
  expect(evaluated("type A = [].<uint8>; type T = [].<uint8>.<{ brand: 'B' }>;"
    + ' String(T === A);')).toBe('false');
  expect(evaluated("type T = [].<uint8>.<{ brand: 'B' }>; type A = [].<uint8>;"
    + ' String(JSON.stringify(Reflect.getReflection(A).metadata || null));')).toBe('null');
});

test('a generic application, a parenthesized type, and a function type', () => {
  expect(evaluated("type Box<T> = { v: T }; type B = Box.<uint8>.<{ brand: 'B' }>;"
    + ' String(Reflect.getReflection(B).kind);')).toBe('parameterized');
  expect(evaluated("type Y = (string | uint8).<{ brand: 'B' }>;"
    + ' String(Reflect.getReflection(Y).kind);')).toBe('parameterized');
  expect(evaluated("type Z = ((a: uint8) => uint8).<{ brand: 'B' }>;"
    + ' String(Reflect.getReflection(Z).kind);')).toBe('parameterized');
});

test('an indexed access can be parameterized', () => {
  expect(evaluated("type O = { a: string }; type X = O['a'].<{ brand: 'B' }>;"
    + ' String(Reflect.getReflection(X).kind);')).toBe('parameterized');
  expect(evaluated("type O = { a: string }; type X = O['a'].<{ brand: 'B' }>;"
    + " type S = O['a']; type Y = S.<{ brand: 'B' }>; String(X === Y);")).toBe('true');
});

// --- Composition, in both orders --------------------------------------------

test('the production is recursive, not a second slot', () => {
  // The mutation guard. An implementation accepting exactly TWO TypeArguments
  // passes every operand-shape test above; only this one tells it from a
  // recursive production.
  expect(evaluated("type C = string.<{ brand: 'A' }>.<{ brand: 'B' }>.<{ brand: 'C' }>;"
    + ' String(Reflect.getReflection(C).kind);')).toBe('parameterized');
});

test('parameterization and indexing compose in either order', () => {
  // Indexing after a parameterization ALREADY worked and must keep working; a
  // fix that repaired the other direction while breaking this one would
  // otherwise pass.
  expect(evaluated("type O = { a: string }; type X = O.<{ brand: 'B' }>['a'];"
    + ' String(Reflect.getReflection(X).kind);')).toBe('primitive');
  expect(evaluated("type O = { a: string }; type X = O['a'].<{ brand: 'B' }>;"
    + ' String(Reflect.getReflection(X).kind);')).toBe('parameterized');
});

test('an array OF a parameterized type is undisturbed', () => {
  expect(evaluated("type E = string.<{ brand: 'E' }>; type A = [].<E>;"
    + ' String(Reflect.getReflection(A).element === E);')).toBe('true');
});

// --- Precedence must not change ---------------------------------------------

test('TypeArguments still binds tighter than | and &', () => {
  // A new postfix production is exactly the kind of change to disturb this.
  expect(evaluated("type U = string.<{ brand: 'A' }> | uint8;"
    + ' String(Reflect.getReflection(U).kind);')).toBe('union');
  expect(evaluated("type I = string.<{ brand: 'A' }> & string.<{ brand: 'B' }>;"
    + ' String(Reflect.getReflection(I).kind);')).toBe('intersection');
  expect(evaluated("type E = string.<{ brand: 'A' }>; type U = E | uint8;"
    + ' String(Reflect.isAssignable(E, U));')).toBe('true');
});

// --- Unaffected -------------------------------------------------------------

test('the single-argument form and bare names are unchanged', () => {
  expect(evaluated("type E = string.<{ brand: 'E' }>;"
    + ' String(Reflect.getReflection(E).kind);')).toBe('parameterized');
  expect(evaluated('type T = string; String(Reflect.getReflection(T).kind);')).toBe('primitive');
});

test('the reflection API builds the same type as both spellings', () => {
  expect(evaluated("type N = string.<{ brand: 'E' }>.<{ brand: 'N' }>;"
    + " const E = Reflect.makeType({ kind: 'parameterized', base: string, metadata: { brand: 'E' } });"
    + " const M = Reflect.makeType({ kind: 'parameterized', base: E, metadata: { brand: 'N' } });"
    + ' String(N === M);')).toBe('true');
});
