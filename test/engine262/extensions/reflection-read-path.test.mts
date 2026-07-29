import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators-remaining.md phase three: the REFLECTION READ PATH.
 *
 * `sec-decorators` specifies reflection and decoration as ONE facility, and the
 * read half answered two of forty-one contexts. Steps 1 and 2 of the plan's
 * staged order: the whole-class read, and the class-family member reads.
 */

/** The kind a rejection carries, through `eval` so an early error is catchable. */
const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('Reflect.Class reads the class back', () => {
  // decorators.md's `ClassReflection`: `name`, `type`, `abstract`, `metadata`.
  expect(evaluated('class A {} Object.getOwnPropertyNames(Reflect.getReflection.<Reflect.Class, A>()).join(",");')).toBe('kind,name,type,abstract,metadata');
  expect(evaluated('class Named {} String(Reflect.getReflection.<Reflect.Class, Named>().name);')).toBe('Named');
  // `type` is the CONSTRUCTOR, asserted by identity - a fresh function would
  // satisfy a `typeof` check.
  expect(evaluated('class A {} String(Reflect.getReflection.<Reflect.Class, A>().type === A);')).toBe('true');
  expect(evaluated('abstract class A {} String(Reflect.getReflection.<Reflect.Class, A>().abstract);')).toBe('true');
  expect(evaluated('class A {} String(Reflect.getReflection.<Reflect.Class, A>().abstract);')).toBe('false');
  // The metadata is the SAME object a decorator wrote to, which is what makes
  // the read path and the metadata channel one facility rather than two that
  // agree.
  expect(evaluated('const k = Symbol("k"); let seen; function f(c) { seen = c.metadata; } @f class A {} '
    + 'String(seen === Reflect.getReflection.<Reflect.Class, A>().metadata);')).toBe('true');
  expect(outcome('Reflect.getReflection.<Reflect.Class, uint8>();')).toBe('TypeError');
});

test('the class-family MEMBER reads answer, from a declaration record', () => {
  // The reflections want `static`, `private`, `protected` and `abstract` -
  // DECLARATION facts that live in the AST at class definition and were
  // recorded nowhere reachable from the type. A per-class record keeps them
  // now, keyed the way the metadata store is, so a read is a lookup.
  expect(evaluated('class A { m() {} } Reflect.getReflection.<Reflect.ClassMethod, A>("m").kind;')).toBe('ClassMethod');
  expect(evaluated('class A { get v(): uint8 { return 1; } } Reflect.getReflection.<Reflect.ClassGetter, A>("v").kind;')).toBe('ClassGetter');
  expect(evaluated('class A { set v(x: uint8) {} } Reflect.getReflection.<Reflect.ClassSetter, A>("v").kind;')).toBe('ClassSetter');
  // A STATIC member's home object IS the constructor while an instance
  // member's is the prototype. Told apart by the NODE rather than by probing
  // the object: walking `constructor` from a constructor reaches `Function`,
  // and the record would be filed under the wrong owner.
  expect(evaluated('class A { static m() {} } String(Reflect.getReflection.<Reflect.ClassMethod, A>("m").static);')).toBe('true');
  expect(evaluated('class A { m() {} } String(Reflect.getReflection.<Reflect.ClassMethod, A>("m").static);')).toBe('false');
  // "Reflection includes inherited members BY DEFAULT" - the same base chain
  // the checker and the metadata store walk.
  expect(evaluated('class B { m() {} } class D extends B {} Reflect.getReflection.<Reflect.ClassMethod, D>("m").kind;')).toBe('ClassMethod');
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "m"; } class A { @f m() {} } '
    + 'String(Reflect.getReflection.<Reflect.ClassMethod, A>("m").metadata[k]);')).toBe('m');
  // MEMBERS ARE RECORDED WHETHER OR NOT THEY ARE DECORATED. The first attempt
  // hooked a line inside the decorator guard, so an undecorated method was
  // unreflectable - a reflection describes what was DECLARED, and whether a
  // decorator ran is no part of that.
  expect(evaluated('class A { undecorated() {} } Reflect.getReflection.<Reflect.ClassMethod, A>("undecorated").kind;')).toBe('ClassMethod');
  expect(outcome('class A {} Reflect.getReflection.<Reflect.ClassMethod, A>("z");')).toBe('TypeError');
});

test('PINNED: the FIELD-shaped members and the remaining forms', () => {
  // An ACCESSOR takes the FieldDefinition arm rather than the method arm, so it
  // is not in the declaration record yet. A FIELD answers through the instance
  // LAYOUT, which is why it throws for a class that has none - the reason a
  // method needed a record at all.
  expect(outcome('class A { accessor a: uint8 = 1; } Reflect.getReflection.<Reflect.ClassAccessor, A>("a");')).toBe('TypeError');
  expect(evaluated('class A { a: uint8; } String(typeof Reflect.getReflection.<Reflect.ClassField, A>("a"));')).toBe('object');
  expect(outcome('class A { a; } Reflect.getReflection.<Reflect.ClassField, A>("a");')).toBe('TypeError');
  // Steps 3 to 5: the enumerating forms, `getReflectionByIndex` (parameter
  // contexts only), and `{ own: true }`.
  expect(outcome('class A { a: uint8; } Reflect.getReflection.<Reflect.ClassField, A>();')).toBe('TypeError');
  expect(evaluated('typeof Reflect.getReflectionByIndex;')).toBe('undefined');
});
