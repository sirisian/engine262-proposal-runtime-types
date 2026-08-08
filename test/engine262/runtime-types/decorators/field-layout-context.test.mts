import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-decorators-remaining.md phase four: `offset` and `byteLength` on a
 * field's decorator context.
 *
 * decorators.md: "Layout, present when the declaring class has one. A STATIC
 * field is not part of an instance's layout, so both are undefined for it."
 */

const GRAB = 'let ctx; function g(c) { ctx = c; } ';

test('a field context reports its OFFSET and BYTE LENGTH', () => {
  expect(evaluated(`${GRAB} class A { x: uint32 = 0; @g a: uint8 = 3; } String(ctx.offset);`)).toBe('4');
  expect(evaluated(`${GRAB} class A { @g a: uint32 = 3; } String(ctx.byteLength);`)).toBe('4');
  // The FIRST field sits at 0, which distinguishes "reported" from "absent" - a
  // falsy-but-present value.
  expect(evaluated(`${GRAB} class A { @g a: uint32 = 3; } String(ctx.offset);`)).toBe('0');
  // And they AGREE with the layout reflection, which is the property that
  // matters: two reflections of one field must not disagree.
  expect(evaluated('class A { x: uint32 = 0; a: uint8 = 3; } '
    + 'String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("a").offset);')).toBe('4');
});

test('a STATIC or UNTYPED field reports neither', () => {
  expect(evaluated(`${GRAB} class A { @g static a: uint8 = 3; } String(ctx.offset);`)).toBe('undefined');
  expect(evaluated(`${GRAB} class A { @g a = 3; } String(ctx.offset);`)).toBe('undefined');
});

test('THE ORDERING RULE these are accessors for', () => {
  // A field decorator runs BEFORE the class's `InstanceLayout` is computed, and
  // SO DO THE `addInitializer` CALLBACKS IT REGISTERS. So a value read at
  // either point would always be *undefined*, and these are ACCESSORS read when
  // ASKED - which is what "present when the declaring class has one" means.
  expect(evaluated('let seen = "X"; function g(c) { seen = String(c.offset); } '
    + 'class A { x: uint32 = 0; @g a: uint8 = 3; } seen;')).toBe('undefined');
  expect(evaluated('let seen = "X"; function g(c) { c.addInitializer(function () { seen = String(c.offset); }); } '
    + 'class A { x: uint32 = 0; @g a: uint8 = 3; } new A(); seen;')).toBe('undefined');
  // Read AFTER the class finishes: present. Twelve cycles of *undefined*
  // readings were all taken from inside `addInitializer`, which is NOT later
  // than the layout assignment.
  expect(evaluated(`${GRAB} class A { x: uint32 = 0; @g a: uint8 = 3; } String(ctx.offset);`)).toBe('4');
});
