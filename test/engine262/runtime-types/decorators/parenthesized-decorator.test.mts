import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * `parseDecorator` produces THREE subtypes: ~CallExpression~,
 * ~MemberExpression~, and ~ParenthesizedExpression~ for the grammar's
 * `@ ( Expression )`. `ApplyDecorators` handled two.
 *
 * The third fell into the branch that reads a `MemberExpression` field off a
 * node that has none, and the *undefined* travelled into `Evaluate` until
 * something dereferenced `.parent` of nothing. `@(d) class A {}` CRASHED THE
 * HOST - not a catchable *TypeError*, an engine fall-over - as did every
 * parenthesized spelling: a factory, an arrow, a member access, on a class, a
 * method or a field. The unparenthesized spelling of each worked, which is what
 * kept it hidden.
 */

const L = "globalThis.L=''; ";
const D = 'function d(t, c) { globalThis.L += "d;"; return t; } ';

test('a parenthesized decorator runs', () => {
  expect(evaluated(`${L}${D}@(d) class A {} globalThis.L;`)).toBe('d;');
  expect(evaluated(`${L}${D}class A { @(d) m() {} } globalThis.L;`)).toBe('d;');
  expect(evaluated(`${L}${D}class A { @(d) x = 1; } globalThis.L;`)).toBe('d;');
});

test('every expression form inside the parentheses', () => {
  expect(evaluated(`${L}function mk() { return function (t, c) { globalThis.L += "f;"; return t; }; } `
    + '@(mk()) class A {} globalThis.L;')).toBe('f;');
  expect(evaluated(`${L}@((t, c) => { globalThis.L += "a;"; return t; }) class A {} globalThis.L;`)).toBe('a;');
  expect(evaluated(`${L}const ns = { d(t, c) { globalThis.L += "m;"; return t; } }; `
    + '@(ns.d) class A {} globalThis.L;')).toBe('m;');
});

test('a parenthesized replacement decorator replaces', () => {
  expect(evaluated('@((t, c) => function Replaced() {}) class A {} A.name;')).toBe('Replaced');
});

test('a parenthesized non-function is refused rather than crashing', () => {
  expectStaticTypeError('@(5) class A {}');
});

/**
 * #sec-decorator-application fixes the order in two phases: "decorator
 * expressions are evaluated in DOCUMENT ORDER, and decorators are applied
 * INNERMOST FIRST AND IN REVERSE SOURCE ORDER".
 *
 * Both hold, and they are pinned together because measuring only the calls
 * looks like a violation of the first: under this clause a decoration with
 * arguments "is EDITING ITS PARAMETER LIST rather than rewriting it into a
 * factory", so `@mk(x)` calls `mk(x, context)` ONCE, in phase two. The
 * evaluation order is visible only in the arguments.
 */
test('expressions evaluate forward and decorators apply backward', () => {
  const B = `${L}function arg(t) { globalThis.L += "arg" + t + ";"; return t; } `
    + 'function mk(x, c) { globalThis.L += "call" + x + ";"; } ';
  expect(evaluated(`${B}@mk(arg("1")) @mk(arg("2")) class A {} globalThis.L;`))
    .toBe('arg1;arg2;call2;call1;');
  expect(evaluated(`${B}@mk(arg("1")) @mk(arg("2")) @mk(arg("3")) class A {} globalThis.L;`))
    .toBe('arg1;arg2;arg3;call3;call2;call1;');
  expect(evaluated(`${B}class A { @mk(arg("1")) @mk(arg("2")) m() {} } globalThis.L;`))
    .toBe('arg1;arg2;call2;call1;');
});
