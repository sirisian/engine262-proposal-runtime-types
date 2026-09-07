import { test, expect } from 'vitest';
import {
  ok, evaluated, expectStaticTypeError, expectThrown,
} from '../harness.mts';

/**
 * An intersection of object types, its distribution into one object type, and
 * the propagation of `never` out of a product position.
 *
 * Three rules meet here and are tested together because each is visible only
 * through the others:
 *
 *   - #sec-canonicalizetype distributes an all-~object~ intersection into one
 *     object type, a member name more than one arm declares taking the
 *     intersection of the types they give it.
 *   - #sec-layout-finiteness empties a product whose required position is
 *     `never`, so a distributed member that reduces empties the object.
 *   - #sec-intersection-type-early-errors reports such a pair at the `&`, where
 *     both types are written, rather than at every use of the annotation.
 *
 * The regression that prompted all three: `{ a: number } & { a: 5 }` interns as
 * `{ a: 5 }` - `T === U` holds - while the annotation refused a literal the
 * direct spelling took. One type, one expression, two answers.
 */

const kind = (source: string) => evaluated(`${source} String(Reflect.getReflection(T).kind);`);
const isNever = (source: string) => evaluated(`${source} String(T === never);`);

test('an all-object intersection is ONE object type', () => {
  // Distribution is not merely a reduction of the empty case: an intersection
  // of object types has no members an object type lacks, so it IS one.
  expect(kind('type T = { a: uint32 } & { b: string };')).toBe('object');
  expect(kind('type T = { a: uint32 } & { b: string } & { c: boolean };')).toBe('object');
  expect(ok('type T = { a: uint32 } & { b: string }; let v: T = { a: 5, b: "x" };')).toBe(true);
  // Every member is required: the intersection requires each arm.
  expectStaticTypeError('type T = { a: uint32 } & { b: string }; let v: T = { a: 5 };');
});

test('an arm that is NOT an object leaves the intersection standing', () => {
  // The distribution is gated on every member being ~object~. An array is a
  // subtype of `Iterable.<T>` and shares values with an object type, so the
  // pair is inhabited and must not be merged into a shape neither arm has.
  expect(kind('type T = [].<uint8> & { length: uint32 };')).toBe('intersection');
  expect(isNever('type T = [].<uint8> & Iterable.<uint8>;')).toBe('false');
});

test('a member two arms declare takes the INTERSECTION of their types', () => {
  // The three answers CanonicalizeType already gives, reached by asking it
  // rather than by a comparison written here:
  //
  //   identical -> deduplicates      { a: uint8 } & { a: uint8 }  is { a: uint8 }
  //   subtype   -> subsumes          { a: number } & { a: 5 }     is { a: 5 }
  //   disjoint  -> `never`           { a: uint32 } & { a: string } is empty
  expect(evaluated('type T = { a: number } & { a: 5 }; type U = { a: 5 }; String(T === U);')).toBe('true');
  expect(evaluated('type T = { a: string } & { a: "x" }; type U = { a: "x" }; String(T === U);')).toBe('true');
  expect(evaluated('type T = { a: uint8 } & { a: uint8 }; type U = { a: uint8 }; String(T === U);')).toBe('true');
});

test('the interned type and the annotation agree', () => {
  // The regression. `T === U` held while the two annotations answered
  // differently, which is a type identity the checker did not use.
  expect(ok('type T = { a: number } & { a: 5 }; let v: T = { a: 5 };')).toBe(true);
  expect(ok('type U = { a: 5 }; let v: U = { a: 5 };')).toBe(true);
  expect(ok('type T = { a: string } & { a: "x" }; let v: T = { a: "x" };')).toBe(true);
  expect(ok('let v: { a: number } & { a: 5 } = { a: 5 };')).toBe(true);
  // A non-literal source through the same alias was never affected, and stays.
  expect(ok('type T = { a: number } & { a: 5 }; let s: { a: 5 } = { a: 5 }; let v: T = s;')).toBe(true);
  // A value the narrowed member does not admit is still refused.
  expectStaticTypeError('type T = { a: number } & { a: 5 }; let v: T = { a: 6 };');
});

test('a numeric literal does not narrow a SIZED numeric member', () => {
  // #sec-literal-types: "The base of a numeric literal is `number` however the
  // literal will be used ... a literal type over another numeric type, the
  // `uint8` 3 as a type, is expressible through construction but not through
  // syntax." A `number` value is not a `uint32` value, which is why
  // `uint8 & number` is `never`, so no value is both a `uint32` and the Number 5.
  //
  // The design document's intersection section annotated
  // `{ a: uint32 } & { a: 5 }` as "Fine: 5 satisfies both". Nothing satisfies
  // both, and this is the test that says so.
  expectStaticTypeError('type T = { a: uint32 } & { a: 5 };');
  expectStaticTypeError('type T = { a: float32 } & { a: 1.5 };');
  // The same pair OUTSIDE an object was already refused, and still is.
  expectStaticTypeError('type T = uint8 & 5;');
});

test('the Early Error names the member and both types', () => {
  // Reported at the `&`. Left to reduction alone the author hears "not
  // assignable" at every USE of the annotation, which
  // #sec-intersection-type-early-errors calls the least useful place to say it.
  expectThrown(
    'type T = { a: uint32 } & { a: string };',
    'no value is of both "uint.<32>" and "string" at member "a", so their intersection is never',
  );
  expectThrown(
    'type T = { a: uint32 } & { a: 5 };',
    'at member "a"',
  );
  // Reported ONCE per node, as the whole-arm rule is.
  expectStaticTypeError('type T = { a: uint32 } & { a: string } & { a: boolean };');
});

test('an OPTIONAL member on either side is not reported and does not empty', () => {
  // A value omitting the member satisfies both arms, so nothing is empty.
  expect(ok('type T = { a?: uint32 } & { a: string };')).toBe(true);
  expect(ok('type T = { a: uint32 } & { a?: string };')).toBe(true);
  expect(isNever('type T = { a?: never };')).toBe('false');
  expect(ok('type T = { a?: never }; let v: T = {};')).toBe(true);
});

test('a REQUIRED member of `never` empties the object', () => {
  // #sec-layout-finiteness. A value of the object would have to hold a value of
  // a type that has none.
  expect(isNever('type T = { a: never };')).toBe('true');
  expect(isNever('type T = { a: uint8, b: never };')).toBe('true');
  // One level deep and on the CANONICAL member types, which composes without a
  // separate inhabitation walk: the inner record reduced first.
  expect(isNever('type T = { a: { b: never } };')).toBe('true');
  expect(isNever('type T = { a: { b: { c: never } } };')).toBe('true');
  // Reached through parameters, since writing the empty intersection is
  // itself an error (#sec-intersection-type-early-errors).
  expect(evaluated('type F<T, U> = { a: T & U }; type G = F.<uint32, string>; String(G === never);')).toBe('true');
});

test('a TUPLE is NOT reduced, though a required position of `never` empties it', () => {
  // The one place propagation is deliberately withheld, and the reason is a
  // second role the tuple has: the type-programming kit reads it as a
  // heterogeneous LIST, where `never` is ordinary data - `[1, never, 'a']` is
  // the input to a filter that drops it (corpus/type-challenges, 399 Tuple
  // Filter). Reducing the list destroys the program that computes over it, and
  // the kit has no other list structure. An object type carries no second
  // reading, so it reduces and this does not.
  expect(isNever('type T = [uint8, never];')).toBe('false');
  expect(isNever('type T = [never];')).toBe('false');
  expect(isNever('type T = [4].<never>;')).toBe('false');
  // The emptiness is still reachable: storing an element is refused.
  expectStaticTypeError('type T = [uint8, never]; let v: T = [1, 2];');
});

test('`never` propagates out of the reference positions', () => {
  // A `ref` names a location (references.md), and there is no location of the
  // empty type. `shared` is the same, its marker not being observable in the
  // value, and a parameterization refines its base and cannot add a value.
  expect(isNever('type T = ref never;')).toBe('true');
});

test('`never` does NOT propagate where a value still exists', () => {
  // The empty array inhabits a variable-length array of anything, there being
  // no element to supply.
  expect(isNever('type T = [].<never>;')).toBe('false');
  expect(ok('let a: [].<never> = [];')).toBe(true);
  // A function type is inhabited by a function that cannot be called, or that
  // does not return; neither position is a product of the value.
  expect(isNever('type T = (never) => uint8;')).toBe('false');
  expect(isNever('type T = (uint8) => never;')).toBe('false');
  // A union needs only one live arm.
  expect(isNever('type T = uint8 | never;')).toBe('false');
});

test('a dead arm drops out of a union rather than infecting it', () => {
  // Flattening drops an empty union, which is what makes the surviving arm the
  // whole type and the slot monomorphic.
  expect(kind('type T = string | { a: never };')).toBe('primitive');
  expect(kind('type T = string | ({ a: uint32 } & { a: never });')).toBe('primitive');
  expect(evaluated('type T = string | { a: never }; type U = string; String(T === U);')).toBe('true');
});

test('a recursive type is not driven to `never` by this', () => {
  // A cycle closes through a REFERENCE position - an array, a nullable union -
  // and neither propagates, so the bottom-up test terminates and the ordinary
  // recursive shapes of #sec-type-alias-declarations are untouched.
  expect(ok('type List = { value: uint32, next: List | null }; let v: List = { value: 1, next: null };')).toBe(true);
  expect(ok('type Tree = { value: float64, children: [].<Tree> }; let v: Tree = { value: 1, children: [] };')).toBe(true);
  expect(isNever('type List = { value: uint32, next: List | null }; type T = List;')).toBe('false');
});

test('a computation reaching an empty intersection gets `never` and does not throw', () => {
  // The Early Error is on the SYNTAX. Canonicalization stays total, which the
  // kit's `exclude(T, T)` and `union(«»)` need, and a generic body is not
  // rejected for an instantiation that may never happen.
  expect(evaluated(
    "String(Reflect.makeType({ kind: 'intersection', members: [type number, type bigint] }) === never);",
  )).toBe('true');
  expect(ok('type F<T> = { a: uint32 } & { a: T };')).toBe(true);
  expect(evaluated('type F<T> = { a: uint32 } & { a: T }; type G = F.<string>; String(G === never);')).toBe('true');
  expect(evaluated('type F<T> = { a: number } & { a: T }; type G = F.<5>; type U = { a: 5 }; String(G === U);')).toBe('true');
});

test('an explicitly written `never` member stays exempt', () => {
  // The annihilation identity of #sec-never-type, spelled out. Making it an
  // error would stop generated code using `never` as a written annihilator.
  expect(evaluated('type N = never; type M = uint8 & never; String(N === M);')).toBe('true');
  expect(ok('type T = { a: never } & { a: never };')).toBe(true);
});

test('distribution keeps index signatures and the key order', () => {
  // An arm's index signatures are carried across and re-sorted by the object
  // arm of CanonicalizeType, so the merged type is canonical like any other.
  expect(kind('type T = { a: uint8 } & { [k: string]: uint8 };')).toBe('object');
  expect(evaluated(
    'type T = { b: uint8 } & { a: string }; type U = { a: string, b: uint8 }; String(T === U);',
  )).toBe('true');
});
