import { test, expect } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

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
  "sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { if (s instanceof A) {} else { if (s instanceof A) {} } }",
])("a test a closed set settles is refused: %s", expectStaticTypeError);

test.each([
  "enum E { A, B } function f(e: E) { if (e) {} } 'ok';",
  "enum E { A = 1, B = 2 } function f(e: E) { if (e === 1) { let x: E = e; } else { let y: E = e; } } 'ok';",
  "enum E { A = 1, B = 1, C = 2, D = 3 } function f(e: E) { if (e === E.B) {} else if (e === E.C) {} } 'ok';",
  "enum E { A, B, C } function f(e: E) { if (e === E.A) {} else if (e === E.B) {} else {} } 'ok';",
  "sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { if (s instanceof A) {} else { let b: B = s; } } 'ok';",
  "enum S: string { A = 'x', B = 'y' } function f(s: S) { if (s === 'x') {} } 'ok';",
])("a test a closed set leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));
