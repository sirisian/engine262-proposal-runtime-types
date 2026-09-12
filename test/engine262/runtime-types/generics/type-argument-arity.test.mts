import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-type-references. A declaration taking _N_ type parameters is
 * applied to at most _N_ arguments, and to at least as many as precede its
 * first default.
 *
 * The run time judged this all along - `f.<uint8, string>(...)` on a
 * `function f<T>` reports "the call takes 2 type arguments; T expects one
 * taking 1" - but only when the call or construction executed. Both sides are
 * written down wherever the arguments are, so #sec-type-errors makes it
 * determinable and it is raised by the checker, with the run time's own
 * wording.
 *
 * Every case below is written inside a function that is never called, so a rule
 * that fires only at run time does not pass this file.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a call supplying the wrong number of type arguments is refused', () => {
  expectThrown(dead('function f<T>(x: T) {} f.<uint8, string>(uint8(1));'),
    'type arguments');
  expectThrown(dead('function f<T>(x: T) {} f.<uint8, string, boolean>(uint8(1));'),
    'type arguments');
  // Too FEW is the same rule read from the other end.
  expectThrown(dead('function f<T, U>(x: T, y: U) {} f.<uint8>(uint8(1), uint8(2));'),
    'type arguments');
  // A method's type parameters are the function's.
  expectThrown(dead('class C { m<T>(x: T) { } } new C().m.<uint8, string>(uint8(1));'),
    'type arguments');
});

test('a construction is counted against the class, as a call is against the function', () => {
  expectThrown(dead('class Box<T> { v: T; constructor(v: T) { this.v = v; } }'
    + ' let b = new Box.<uint8, string>(uint8(1));'), 'type arguments');
  // A VALUE parameter counts like any other; what distinguishes it is what an
  // argument may be, not how many there are.
  expectThrown(dead('class G<W: uint32> { v: uint8 = uint8(1); } let g = new G.<8, 9>();'),
    'type arguments');
});

test('what the count does not reach', () => {
  // The exact number, and no type arguments at all, which is inference.
  expect(ok(dead('function f<T>(x: T) {} f.<uint8>(uint8(1));'))).toBe(true);
  expect(ok(dead('function f<T>(x: T) {} f(uint8(1));'))).toBe(true);
  expect(ok(dead('class Box<T> { v: T; constructor(v: T) { this.v = v; } }'
    + ' let b = new Box.<uint8>(uint8(1));'))).toBe(true);
  expect(ok(dead('class G<W: uint32> { v: uint8 = uint8(1); } let g = new G.<8>();'))).toBe(true);

  // A parameter with a DEFAULT may be omitted, and supplied.
  expect(ok(dead('function f<T, U = string>(x: T) {} f.<uint8>(uint8(1));'))).toBe(true);
  expect(ok(dead('function f<T, U = string>(x: T) {} f.<uint8, boolean>(uint8(1));'))).toBe(true);

  // A PACK takes any number, so the declaration has no fixed arity to compare
  // against and the count is not judged.
  expect(ok(dead('function f<...T>(...x: T) {} f.<uint8, string, boolean>(uint8(1));'))).toBe(true);

  // A NAMED argument supplies a parameter by name, so its position says nothing
  // about how many were supplied; a mistake there is orderTypeArguments's to
  // report.
  expect(ok(dead('function f<T, U = string>(x: T) {} f.<U: boolean, T: uint8>(uint8(1));'))).toBe(true);

  // A callee that declares no type parameters is not this rule's business.
  expect(ok(dead('function f(x: uint8) {} f(uint8(1));'))).toBe(true);
});
