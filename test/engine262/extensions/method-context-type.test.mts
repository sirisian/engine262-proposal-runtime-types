import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators-remaining.md phase four: `type` on `ClassMethodReflection`.
 *
 * decorators.md gives a method's context its declared RETURN type. The builder
 * took no NODE at all, which is why it could not report one - it was handed a
 * kind, a key and a flag, none of which knows the declaration.
 */

test('a method context reports its declared RETURN type', () => {
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { @g m(): uint8 { return uint8(1); } } return String(t === (type uint8)); })();')).toBe('true');
  // A DIFFERENT return type is reported as itself, which is what says the
  // annotation is read rather than a constant returned.
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { @g m(): string { return ""; } } return String(t === (type string)); })();')).toBe('true');
  expect(evaluated('(() => { let t; function g(c) { t = c.type; } '
    + 'class A { @g m(): string { return ""; } } return String(t === (type uint8)); })();')).toBe('false');
  // An UNANNOTATED method reports *undefined* rather than inventing a type.
  expect(evaluated('(() => { let t = "X"; function g(c) { t = String(c.type); } '
    + 'class A { @g m() {} } return t; })();')).toBe('undefined');
});

test('the rest of the method context is unchanged', () => {
  expect(evaluated('(() => { let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } '
    + 'class A { @g m(): uint8 { return uint8(1); } } return f; })();'))
    .toBe('kind,name,static,private,abstract,type,classContext,metadata,addInitializer');
  // A static method and an operator go through the same builder.
  expect(evaluated('(() => { let k; function g(c) { k = c.kind; } '
    + 'class A { @g static m(): uint8 { return uint8(1); } } return k; })();')).toBe('ClassMethod');
  expect(evaluated('(() => { let k; function g(c) { k = c.kind; } '
    + 'class O { @g operator +(r: O): O { return r; } } return k; })();')).toBe('ClassOperator');
});

test('PINNED: `signatures` is still absent', () => {
  // decorators.md gives `signatures` beside `type` for an OVERLOADED method.
  // The overload group is what would supply it, and the context reports the one
  // declaration it was handed.
  expect(evaluated('(() => { let s = "X"; function g(c) { s = String(c.signatures); } '
    + 'class A { @g m(): uint8 { return uint8(1); } } return s; })();')).toBe('undefined');
});
