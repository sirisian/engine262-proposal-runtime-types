import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-type-parameters: an established upper bound supplies the contracts a
// generic body is checked against, and a narrowing test is one: a test dead for
// every specialization the bound admits is refused (#sec-narrowfrom), while one
// dead for some specializations only is not.

test.each([
  "function f<T: type extends uint8>(x: T) { if (x === null) {} }",
  "function f<T: type extends uint8>(x: T) { if (typeof x === 'string') {} }",
  "function f<T: type extends uint8 | string>(x: T) { if (x is boolean) {} }",
  "function f<T: type extends uint8>(x: T) { return x ?? 0; }",
  "function f<T: type extends uint8>(x: T) { if (x is uint8) {} }",
  "function f<T: type extends { a: uint8 }>(x: T) { if (x) {} }",
])("a test the bound settles is refused: %s", expectStaticTypeError);

test.each([
  "function f<T: type extends uint8 | string>(x: T) { if (x is string) {} } 'ok';",
  "function f<T: type>(x: T) { if (x === null) {} } 'ok';",
])("a test the bound leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));
