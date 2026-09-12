import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-type-errors. A parameter that requires a value and that the call
 * supplies nothing for is a determinable violation - the parameter's type is at
 * the declaration and the argument count at the call. The run time made the
 * judgment already, reporting "undefined is not assignable to uint.<8>" from
 * the binding of the missing parameter; it is raised at the call instead.
 *
 * Every case is inside a function that is never called, so a rule firing only
 * at run time does not pass this file.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a parameter requiring a value must be supplied', () => {
  expectThrown(dead('function f(a: uint8, b: uint8) {} f(uint8(1));'), 'is not supplied');
  expectThrown(dead('function f(a: uint8) {} f();'), 'is not supplied');
  expectThrown(dead('class C { m(a: uint8, b: uint8) {} } new C().m(uint8(1));'), 'is not supplied');
  expectThrown(dead('class C { constructor(a: uint8, b: uint8) {} } let c = new C(uint8(1));'),
    'is not supplied');
  expectThrown(dead('let g: (a: uint8, b: uint8) => void = (a, b) => {}; g(uint8(1));'),
    'is not supplied');
});

test('a parameter nothing is required for', () => {
  // Each of these is satisfied by the call supplying nothing.
  expect(ok(dead('function f(a: uint8, b?: uint8) {} f(uint8(1));'))).toBe(true);
  expect(ok(dead('function f(a: uint8, b: uint8 = uint8(2)) {} f(uint8(1));'))).toBe(true);
  expect(ok(dead('function f(a: uint8, ...r: [].<uint8>) {} f(uint8(1));'))).toBe(true);
  expect(ok(dead('function f(...r: [].<uint8>) {} f();'))).toBe(true);
  // A type admitting *undefined* is satisfied by the *undefined* left behind,
  // and an untyped parameter is `any`, which admits it too.
  expect(ok(dead('function f(a: uint8 | undefined) {} f();'))).toBe(true);
  expect(ok(dead('function f(a, b) {} f(1);'))).toBe(true);
  expect(ok(dead('function f(a: uint8, b) {} f(uint8(1));'))).toBe(true);
});

test('the count is not the whole story, and where it is not the rule stands down', () => {
  // A SPREAD supplies as many arguments as its operand has elements, which is a
  // run-time fact.
  expect(ok(dead('function f(a: uint8, b: uint8) {} let r: [].<uint8> = []; f(...r);'))).toBe(true);

  // A NAMED argument fills a parameter by name, so the positional count says
  // nothing about which were filled - here `b` is filled and the defaulted `a`
  // is left alone.
  expect(ok(dead('function f(a: string = "d", b: string) { return a + b; } let q = f(b: "a");'))).toBe(true);

  // A REST may be FOLLOWED by parameters, so a parameter's index is not its
  // argument's index: `b` is filled from the last argument whatever the count.
  expect(ok(dead('function f(...a: [].<number>, b: string) { return b; } let q = f("x");'))).toBe(true);
  expect(ok(dead('function f(...a: [].<number>, b: string) { return b; } let q = f(1, 2, "x");'))).toBe(true);

  // Extra arguments are admitted (spec 3505), and an `any` callee is not judged.
  expect(ok(dead('function f(a: uint8) {} f(uint8(1), uint8(2));'))).toBe(true);
  expect(ok(dead('let a: any = (x) => x; let q = a();'))).toBe(true);
});

test('an OVERLOADED name is answered by resolution, not by this rule', () => {
  const O = 'function f(a: uint8): uint8 { return a; }'
    + ' function f(a: uint8, b: uint8): uint8 { return a; } ';
  expect(ok(dead(`${O}let q = f(uint8(1));`))).toBe(true);
  expect(ok(dead(`${O}let q = f(uint8(1), uint8(2));`))).toBe(true);
  // Where no arm accepts the count, resolution reports it - the better
  // diagnostic for a set than one parameter's name.
  expectThrown(dead(`${O}let q = f();`), 'no declared signature accepts');
});
