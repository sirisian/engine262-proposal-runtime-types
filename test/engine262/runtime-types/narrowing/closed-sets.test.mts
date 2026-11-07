import { test, expect } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowto, the closed-set reading: an enum narrows as its enumerators and a
// `sealed abstract` class as its direct subclasses, in `if` and truthiness as in
// `switch` and `match` (#sec-enums, #sec-sealed-classes, #table-falsy-and-truthy-parts).

test.each([
  "enum E { A = 1, B = 2 } function f(e: E) { if (e === 3) {} }",
  "enum E { A = 1, B = 2 } function f(e: E) { if (e !== 3) {} }",
  "enum E { A = 1, B = 2 } function f(e: E) { if (e is 3) {} }",
  "enum E { A = 1, B = 2 } function f(e: E) { return match (e) { when 3: 1; default: 2; }; }",
  "enum E { A = 1, B = 2 } function f(e: E) { if (e) {} }",
  "enum E { A, B } function f(e: E) { if (e === E.A) {} else { if (e === E.A) {} } }",
  "enum E { A, B } function f(e: E) { if (e === E.A) {} else if (e === E.B) {} else {} }",
  "{ sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { if (s instanceof A) {} else { if (s instanceof A) {} } } }",
])("a test a closed set settles is refused: %s", expectStaticTypeError);

test.each([
  "enum E { A, B } function f(e: E) { if (e) {} } 'ok';",
  "enum E { A = 1, B = 2 } function f(e: E) { if (e === 1) { let x: E = e; } else { let y: E = e; } } 'ok';",
  "enum E { A = 1, B = 1, C = 2, D = 3 } function f(e: E) { if (e === E.B) {} else if (e === E.C) {} } 'ok';",
  "enum E { A, B, C } function f(e: E) { if (e === E.A) {} else if (e === E.B) {} else {} } 'ok';",
  "{ sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { if (s instanceof A) {} else { let b: B = s; } } 'ok'; }",
  "enum S: string { A = 'x', B = 'y' } function f(s: S) { if (s === 'x') {} } 'ok';",
])("a test a closed set leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));

// #sec-instanceof-operator: an earlier `instanceof` on a class's instances, and
// a read of a typed field the class declares, have no intervening effect, so a
// later test the sealed hierarchy settles is still judged. A member the class
// does not declare as a typed field may be, or become, an accessor, and keeps
// the test open.
test.each([
  "{ sealed abstract class S { n: uint8 = 1; } class A extends S {} class B extends S {} function f(s: S) { if (s instanceof A) {} else { s.n; if (s instanceof A) {} } } }",
  "{ sealed abstract class S { #n = 1; m() { return this.#n; } } class A extends S {} class B extends S {} function f(s: S) { if (s instanceof A) {} else { if (s instanceof B) {} else {} if (s instanceof A) {} } } }",
])("a settled test after an earlier test or a field read is refused: %s", expectStaticTypeError);

test.each([
  "{ sealed abstract class S { n: uint8 = 1; } class A extends S {} class B extends S {} function f(s: S) { if (s instanceof A) {} else { s.m; if (s instanceof A) {} } } } 'ok';",
  "{ sealed abstract class S { n = 1; } class A extends S {} class B extends S {} function f(s: S) { if (s instanceof A) {} else { s.n; if (s instanceof A) {} } } } 'ok';",
  "{ sealed abstract class S { get n() { return 1; } } class A extends S {} class B extends S {} function f(s: S) { if (s instanceof A) {} else { s.n; if (s instanceof A) {} } } } 'ok';",
])("a member read that may run an accessor leaves the later test open: %s", (source) => expect(ok(source)).toBe(true));
