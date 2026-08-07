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

test('an ACCESSOR reads back too', () => {
  // An accessor takes the FieldDefinition arm rather than the method arm, so it
  // needed its own recording - placed where the arm runs for EVERY field and
  // accessor, decorated or not, which is the rule the method arm had to learn
  // as well. The NAME comes from the node: an accessor's record carries its
  // backing Private Name, and a reflection names what was declared.
  expect(evaluated('class A { accessor a: uint8 = 1; } const r = Reflect.getReflection.<Reflect.ClassAccessor, A>("a"); r.kind + "/" + String(r.name);')).toBe('ClassAccessor/a');
  expect(evaluated('class A { accessor plain: uint8 = 1; } Reflect.getReflection.<Reflect.ClassAccessor, A>("plain").kind;')).toBe('ClassAccessor');
  expect(evaluated('class A { static accessor a: uint8 = 1; } String(Reflect.getReflection.<Reflect.ClassAccessor, A>("a").static);')).toBe('true');
});

test('the ENUMERATING forms, and `{ own: true }`', () => {
  // decorators.md's signature returns "{ [name]: Reflection }" - an object
  // keyed by member name, not a list.
  expect(evaluated('class A { m() {} n() {} } Object.keys(Reflect.getReflection.<Reflect.ClassMethod, A>()).sort().join(",");')).toBe('m,n');
  // "Reflection includes inherited members BY DEFAULT."
  expect(evaluated('class B { base() {} } class D extends B { own() {} } '
    + 'Object.keys(Reflect.getReflection.<Reflect.ClassMethod, D>()).sort().join(",");')).toBe('base,own');
  // "To query only the members a class declares itself, pass `{ own: true }`."
  expect(evaluated('class B { base() {} } class D extends B { own() {} } '
    + 'Object.keys(Reflect.getReflection.<Reflect.ClassMethod, D>({ own: true })).join(",");')).toBe('own');
  // The CONTEXT filters the kind, so a getter is not among the methods.
  expect(evaluated('class A { m() {} get v(): uint8 { return 1; } } '
    + 'Object.keys(Reflect.getReflection.<Reflect.ClassGetter, A>()).join(",");')).toBe('v');
  // A REDECLARATION SHADOWS rather than doubling: the chain is walked from the
  // derived class outward and a name already seen is not replaced, which is the
  // same direction the metadata prototype chain resolves in. Counting is what
  // catches the other order - both would contain `m`.
  expect(evaluated('class B { m() {} } class D extends B { m() {} } '
    + 'String(Object.keys(Reflect.getReflection.<Reflect.ClassMethod, D>()).length);')).toBe('1');
});

test('the two FIELD paths are merged into one read', () => {
  // A field's reflection drew on the LAYOUT alone, so it answered only for a
  // class that had one - and the declaration record built for methods held
  // fields too. Two paths that disagreed about the same question. Merged: the
  // record supplies what was DECLARED, the layout supplies where it SITS.
  expect(evaluated('class A { a: uint8; b: uint32; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").offset);')).toBe('4');
  expect(evaluated('class A { static s: uint8 = 1; } String(Reflect.getReflection.<Reflect.ClassField, A>("s").static);')).toBe('true');
  // A class with NO layout reads its declaration facts and reports no
  // placement - absent rather than *undefined* would be wrong here, since the
  // field genuinely has no offset to report.
  // `kind` names the CONTEXT, so this is 'ClassField' - it read 'field', the one
  // shape reporting something other than the context that produced it.
  expect(evaluated('class A { a; b: uint8; } Reflect.getReflection.<Reflect.ClassField, A>("b").kind;')).toBe('ClassField');
  expect(evaluated('class A { a; b: uint8; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").offset);')).toBe('undefined');
  // A name that was never declared is still refused, which is what says the
  // merge widened the answer rather than the acceptance.
  expect(outcome('class A { a: uint8; } Reflect.getReflection.<Reflect.ClassField, A>("z");')).toBe('TypeError');
});

test('getReflectionByIndex returns a member\'s PARAMETERS, indexed', () => {
  // Step 4, and the last of phase three. decorators.md declares it only for the
  // PARAMETER contexts, and it returns a LIST indexed by position - which is
  // what separates it from the enumerating forms, whose result is keyed by
  // name.
  const m = 'class A { m(a: uint8, b: uint8) {} } ';
  expect(evaluated(`${m} const p = Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>("m"); `
    + 'String(p.length) + "/" + p[0].name + "/" + p[1].name;')).toBe('2/a/b');
  expect(evaluated(`${m} String(Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>("m")[1].index);`)).toBe('1');
  // `hasDefault` rather than a value: a parameter's default is an expression
  // evaluated PER CALL, so what can be reported at reflection time is whether
  // one was written - the same reason a field's `initial` is the declared
  // default rather than a per-instance one.
  expect(evaluated('class A { m(a: uint8, b: uint8 = 2) {} } '
    + 'const p = Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>("m"); '
    + 'String(p[0].hasDefault) + "/" + String(p[1].hasDefault);')).toBe('false/true');
  // A member with no parameters answers with an empty list, not a rejection.
  expect(evaluated('class A { m() {} } String(Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>("m").length);')).toBe('0');
  // A SETTER's single parameter comes from a different formals list on the
  // node, so it is asserted separately - one list per member shape, and reading
  // only the method's would have left setters empty.
  expect(evaluated('class A { set v(x: uint8) {} } String(Reflect.getReflectionByIndex.<Reflect.ClassSetterParameter, A>("v")[0].name);')).toBe('x');
  // A context that is not a PARAMETER one is refused: this form is for
  // parameter lists, and answering a member context with a list would invent a
  // reading the design does not give.
  expect(outcome('class A { m() {} } Reflect.getReflectionByIndex.<Reflect.ClassMethod, A>("m");')).toBe('TypeError');
  expect(outcome('Reflect.getReflectionByIndex();')).toBe('TypeError');
});
