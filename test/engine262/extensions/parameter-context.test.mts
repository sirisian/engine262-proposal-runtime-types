import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators-remaining.md phase four:
 * `ClassMethodParameterReflection`'s `type`, `name` and `initial`.
 *
 * decorators.md gives a parameter's context `type`, `name`, `index`, `initial`
 * and `metadata`. The builder took no NODE, so it could report only what its
 * arguments carried - the same gap the method context had, and the parameter
 * node was sitting in the loop that calls it.
 */

test('a parameter context reports its NAME and declared TYPE', () => {
  expect(evaluated('(() => { let n; function g(c) { n = c.name; } '
    + 'class A { m(@g x: uint32) {} } return n; })();')).toBe('x');
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { m(@g x: uint32) {} } return String(t === (type uint32)); })();')).toBe('true');
  // A different annotation reports as itself, which says the node is read
  // rather than a constant returned.
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { m(@g x: string) {} } return String(t === (type string)); })();')).toBe('true');
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { m(@g x: string) {} } return String(t === (type uint32)); })();')).toBe('false');
});

test('`initial` is the DECLARED default, on a field\'s terms', () => {
  // A constant is reported; anything else is *undefined* rather than evaluated,
  // since evaluating a parameter default at CLASS DEFINITION would run it at
  // the wrong time and once rather than per call.
  expect(evaluated('(() => { let i; function g(c) { i = c.initial; } '
    + 'class A { m(@g x: uint32 = 7) {} } return String(i); })();')).toBe('7');
  expect(evaluated('(() => { let i = "X"; function g(c) { i = String(c.initial); } '
    + 'class A { m(@g x: uint32) {} } return i; })();')).toBe('undefined');
  expect(evaluated('(() => { let i = "X"; function g(c) { i = String(c.initial); } '
    + 'class A { m(@g x: uint32 = f()) {} } return i; })();')).toBe('undefined');
});

test('the rest of the sub-target family is unchanged', () => {
  expect(evaluated('(() => { let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } '
    + 'class A { m(@g x: uint32) {} } return f; })();')).toBe('kind,index,name,type,initial,methodContext');
  // `index` still identifies WHICH parameter.
  expect(evaluated('(() => { let i; function g(c) { i = c.index; } '
    + 'class A { m(a: uint8, @g x: uint32) {} } return String(i); })();')).toBe('1');
  // A RETURN sub-target carries no index and gains none of these - "a parameter
  // carries its `index`; a return does not, which is what distinguishes the two
  // beyond the context type".
  expect(evaluated('(() => { let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } '
    + 'class A { m(): @g uint8 { return uint8(1); } } return f; })();')).toBe('kind,methodContext');
});

test('PINNED: `metadata` on a parameter', () => {
  // decorators.md gives `metadata` on `ClassMethodParameterReflection` beside
  // the three that landed. `signatures` on a method LANDED - see
  // method-signatures.test.mts.
  expect(evaluated('(() => { let m = "X"; function g(c) { m = String(c.metadata); } '
    + 'class A { m(@g x: uint32) {} } return m; })();')).toBe('undefined');
});
