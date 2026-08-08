import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-decorators-remaining.md phase three, completed: the READ PATH reports a
 * member's `type`, and reports the SAME type the decorator context does.
 *
 * decorators.md gives a member reflection a `type`. The read path had none while
 * the context did - **two reflections of one declaration disagreeing**, which is
 * the failure this plan has met more often than any other. Both now answer from
 * one recorded type, derived by one operation.
 */

test('a member READ reports its declared FUNCTION type', () => {
  expect(evaluated('type F = (x: uint8) => uint8; class A { m(x: uint8): uint8 { return x; } } '
    + 'String(Reflect.getReflection.<Reflect.ClassMethod, A>("m").type === (type F));')).toBe('true');
  // A GETTER's is `() => T`.
  expect(evaluated('type G = () => uint8; class A { get s(): uint8 { return uint8(1); } } '
    + 'String(Reflect.getReflection.<Reflect.ClassGetter, A>("s").type === (type G));')).toBe('true');
  // A member that annotates nothing reports nothing, rather than a function
  // type of all-`any`.
  expect(evaluated('class A { m() {} } String(Reflect.getReflection.<Reflect.ClassMethod, A>("m").type);')).toBe('undefined');
});

test('THE READ PATH AND THE DECORATOR CONTEXT AGREE, BY IDENTITY', () => {
  // The assertion that matters. Two facilities describing one declaration must
  // not merely both be "a function type" - they must be THE SAME type object,
  // which is what says they answer from one source rather than two derivations
  // that happen to coincide today.
  expect(evaluated('let t; function g(c) { t = c.type; } class A { @g m(x: uint8): uint8 { return x; } } '
    + 'String(t === Reflect.getReflection.<Reflect.ClassMethod, A>("m").type);')).toBe('true');
  expect(evaluated('let t; function g(c) { t = c.type; } class A { @g get s(): uint8 { return uint8(1); } } '
    + 'String(t === Reflect.getReflection.<Reflect.ClassGetter, A>("s").type);')).toBe('true');
  // And an UNDECORATED member is reflectable with its type - whether a decorator
  // ran is no part of what was DECLARED, which is the owner-gating mistake this
  // plan records four separate instances of.
  expect(evaluated('type F = (x: uint8) => uint8; class A { m(x: uint8): uint8 { return x; } } '
    + 'String(Reflect.getReflection.<Reflect.ClassMethod, A>("m").type === (type F));')).toBe('true');
});

test('an INHERITED member reports its type too', () => {
  // Reflection "includes inherited members by default", so the base chain is
  // walked - and the type has to survive that walk.
  expect(evaluated('type F = (x: uint8) => uint8; class B { m(x: uint8): uint8 { return x; } } class D extends B {} '
    + 'String(Reflect.getReflection.<Reflect.ClassMethod, D>("m").type === (type F));')).toBe('true');
  // An OVERRIDE reports the derived declaration's type, not the base's.
  expect(evaluated('type G = () => uint8; class B { m(): uint8 { return uint8(1); } } '
    + 'class D extends B { m(): uint8 { return uint8(2); } } '
    + 'String(Reflect.getReflection.<Reflect.ClassMethod, D>("m").type === (type G));')).toBe('true');
});
