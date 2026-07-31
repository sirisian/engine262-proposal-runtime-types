import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators-remaining.md phase four: `type` on `ClassMethodReflection`.
 *
 * decorators.md gives a method's context its declared RETURN type. The builder
 * took no NODE at all, which is why it could not report one - it was handed a
 * kind, a key and a flag, none of which knows the declaration.
 */

test('a method context reports its FUNCTION type', () => {
  // decorators.md: `ClassMethodReflection<T extends (...args) => any>` has
  // `type: T`, and `ClassGetterReflection` has `type: () => T`. BOTH ARE THE
  // MEMBER'S FUNCTION TYPE, not its return type - which cycle 197 got wrong,
  // reporting the return and so making a getter's `type` indistinguishable from
  // its RETURN sub-target's.
  expect(evaluated('type F = (x: uint32) => uint8; let r; function g(c) { r = String(c.type === (type F)); } '
    + 'class A { @g m(x: uint32): uint8 { return uint8(1); } } r;')).toBe('true');
  // The discriminating assertion: it is NOT the return type.
  expect(evaluated('let r; function g(c) { r = String(c.type === (type uint8)); } '
    + 'class A { @g m(x: uint32): uint8 { return uint8(1); } } r;')).toBe('false');
  // A GETTER's is `() => T`, which is what makes it differ from its RETURN
  // sub-target, whose `type` is T itself.
  expect(evaluated('type G = () => uint8; let r; function g(c) { r = String(c.type === (type G)); } '
    + 'class A { @g get s(): uint8 { return uint8(1); } } r;')).toBe('true');
  expect(evaluated('let r; function g(c) { r = String(c.type === (type uint8)); } '
    + 'class A { m(): @g uint8 { return uint8(1); } } r;')).toBe('true');
  // A member that annotates NOTHING reports nothing, rather than a function
  // type of all-`any` - so "unannotated" stays distinguishable from "annotated
  // as any".
  expect(evaluated('let r; function g(c) { r = String(c.type); } class A { @g m() {} } r;')).toBe('undefined');
});
test('the rest of the method context is unchanged', () => {
  expect(evaluated('(() => { let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } '
    + 'class A { @g m(): uint8 { return uint8(1); } } return f; })();'))
    .toBe('kind,name,static,private,abstract,type,signatures,classContext,metadata,addInitializer');
  // A static method and an operator go through the same builder.
  expect(evaluated('(() => { let k; function g(c) { k = c.kind; } '
    + 'class A { @g static m(): uint8 { return uint8(1); } } return k; })();')).toBe('ClassMethod');
  expect(evaluated('(() => { let k; function g(c) { k = c.kind; } '
    + 'class O { @g operator +(r: O): O { return r; } } return k; })();')).toBe('ClassOperator');
});

test('`signatures` is present, and length 1', () => {
  // decorators.md: "Length 1 when not overloaded." A CLASS METHOD is never
  // overloaded in this engine - a second declaration of one name REPLACES the
  // first, unlike a function declaration, which does form an overload group -
  // so this is always the one declaration the context was handed.
  expect(evaluated('(() => { let s; function g(c) { s = c.signatures.length; } '
    + 'class A { @g m(): uint8 { return uint8(1); } } return String(s); })();')).toBe('1');
});
