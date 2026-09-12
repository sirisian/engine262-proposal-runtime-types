import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * `AreDisjoint` decided the primitives and stopped there: every ~nominal~ fell
 * through to "not disjoint", so a class instance compared with a string, and an
 * enum compared with a string, were silent where `uint8 === string` is refused -
 * one rule reaching half the type system.
 *
 * A nominal is object-like, with one exception. An ENUM is a nominal whose
 * values are those of its UNDERLYING type (#sec-enums, "an enum is a subtype of
 * its underlying type"), so its inhabitants are numbers rather than objects and
 * it overlaps every type its underlying one does. The record carries
 * `Underlying` for the subtype relation, and that is what tells the two apart.
 */

const dead = (source: string) => `function __never() { ${source} }`;
const D = 'class C {} class D2 {} let c: C = new C(); let d: D2 = new D2();'
  + ' enum E { A = 1, B = 2 } let e: E = E.A;'
  + ' let s: string = "x"; let n: uint8 = uint8(1); ';

test('a class instance is disjoint from a primitive', () => {
  expectThrown(dead(`${D}let q = c === s;`), 'disjoint');
  expectThrown(dead(`${D}let q = c === n;`), 'disjoint');
  // The same defensive comparison a primitive already refuses: `uint8 ===
  // undefined` has always been this error, and a class is no different.
  expectThrown(dead(`${D}let q = c === undefined;`), 'disjoint');
  expectThrown(dead(`${D}let q = c === null;`), 'disjoint');
});

test('an enum follows its UNDERLYING type, not its nominal kind', () => {
  // No value of `E` is a string.
  expectThrown(dead(`${D}let q = e === s;`), 'disjoint');
  expectThrown(dead(`${D}let q = s === e;`), 'disjoint');
  // ...and its underlying `number` is disjoint from `uint8`, exactly as a
  // `number` binding already is.
  expectThrown(dead(`${D}let x: number = 1; let q = n === x;`), 'disjoint');
  expectThrown(dead(`${D}let q = e === n;`), 'disjoint');
  // An enum against its own underlying type, and against its own members, is
  // ordinary.
  expect(ok(dead(`${D}let x: number = 1; let q = e === x;`))).toBe(true);
  expect(ok(dead(`${D}let q = e === E.B;`))).toBe(true);
  expect(ok(dead(`${D}let q = e === 1;`))).toBe(true);
  expect(ok(dead('enum F: int32 { A = 1 } let f: F = F.A; let i: int32 = int32(1); let q = f === i;'))).toBe(true);
});

test('two unrelated CLASSES have no common value', () => {
  // The judgment the empty-intersection rule already made, at the comparison
  // site as well: JavaScript has single inheritance and #sec-runtimetypeof
  // gives a value the nominal record of ONE class, so no value is an instance
  // of two classes neither of which extends the other.
  expectThrown(dead(`${D}let q = c === d;`), 'disjoint');
  expectThrown(dead(`${D}let q = d !== c;`), 'disjoint');

  // A RELATED pair shares values and is spared, in both directions.
  expect(ok(dead('class A { } class B extends A { } let a: A = new A(); let b: B = new B();'
    + ' let q = a === b;'))).toBe(true);
  expect(ok(dead('class A { } class B extends A { } let a: A = new A(); let b: B = new B();'
    + ' let q = b === a;'))).toBe(true);
  expect(ok(dead(`${D}let q = c === c;`))).toBe(true);

  // A class against an INTERFACE is not this case: a class may implement any
  // number of them.
  expect(ok(dead('interface I { a: uint8 } class K implements I { a: uint8 = uint8(1); }'
    + ' let k: K = new K(); function f(i: I) { let q = k === i; }'))).toBe(true);
});

test('what the rule does not claim', () => {
  // A LIBRARY nominal is not a ClassDeclaration, so the class rule does not
  // reach it - the same limit the empty-intersection rule has.
  expect(ok(dead('let a: Map.<string, uint8> = new Map(); let b: Set.<uint8> = new Set();'
    + ' let q = a === b;'))).toBe(true);
  // A nullable type admits the null, so the comparison decides something.
  expect(ok(dead('class C {} let m: C | null = null; let q = m === null;'))).toBe(true);
  // The LOOSE form is the escape, as it is for a primitive.
  expect(ok(dead(`${D}let q = c == null;`))).toBe(true);
  expect(ok(dead(`${D}let q = c === c;`))).toBe(true);
});
