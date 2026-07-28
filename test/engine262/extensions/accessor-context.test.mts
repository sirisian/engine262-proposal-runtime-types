import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-accessor.md stage E: the decorator context, and the `protected` modifier
 * it needed first.
 *
 * `Reflect.ClassAccessor` is the context PLAN-decorators.md §9 recorded as
 * having no test asserting a decorator ever received it - the last of the class
 * family, and the one that needed a whole declaration form built to reach.
 */

test('a decorated accessor receives ClassAccessor, once', () => {
  const one = 'let k = "NO"; function f(c) { k = c.kind; } ';
  expect(evaluated(`${one} class A { @f accessor a: uint32 = 5; } k;`)).toBe('ClassAccessor');
  // It fires ONCE, not as a ClassGetter and a ClassSetter. decorators.md is
  // explicit that the declaration form fixes the context - "Accessor is
  // required so that all decorators see the same context ... `signal` runs
  // before `validate` and both see an accessor" - and a desugaring-first
  // implementation would naturally have produced the pair, so the COUNT is
  // asserted and not only the kind.
  expect(evaluated('let n = 0; function f(c) { n += 1; } class A { @f accessor a: uint32 = 5; } String(n);')).toBe('1');
  // A plain field is undisturbed, which is what says the two were parted rather
  // than one renamed.
  expect(evaluated(`${one} class A { @f a: uint32 = 5; } k;`)).toBe('ClassField');
  // And the context selects an overload by TYPE, which is what the whole
  // machinery is for and what a `kind` string alone would not prove.
  const both = 'const l = []; function f(c: Reflect.ClassField) { l.push("field"); } '
    + 'function f(c: Reflect.ClassAccessor) { l.push("accessor"); } ';
  expect(evaluated(`${both} class A { @f a: uint32 = 1; @f accessor b: uint32 = 2; } l.join(",");`)).toBe('field,accessor');
});

test('the context carries ClassAccessorReflection\'s shape', () => {
  // decorators.md: `type`, `name`, `static`, `private`, `protected`, `initial`,
  // `metadata` - and notably NO `readonly`, which ClassFieldReflection has.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.name);`)).toBe('a');
  expect(evaluated(`${grab} class A { @f static accessor a: uint32 = 5; } String(c.static);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.static);`)).toBe('false');
  expect(evaluated(`${grab} class A { @f protected accessor a: uint32 = 5; } String(c.protected);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.protected);`)).toBe('false');
  // `readonly` is absent from the reflection, so it is absent from the context -
  // asserted, because copying the field context would have brought it along.
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(Object.prototype.hasOwnProperty.call(c, "readonly"));`)).toBe('false');
  // The name is the DECLARED one, not the backing storage: stage B's backing is
  // an unnameable Private Name, and a context naming it would describe the
  // desugaring rather than the declaration.
  expect(evaluated(`${grab} class A { @f accessor value: uint32 = 5; } String(c.name);`)).toBe('value');
});

test('PROTECTED parses, reports, and does not move the layout', () => {
  // README: "Like `readonly` and `static` it is a modifier on an ordinary
  // member, in the public layout slot." It had not parsed at all - `protected`
  // is a FutureReservedWord in strict mode and a class body is always strict,
  // so it needed its own test rather than falling out of the identifier path
  // the way `readonly` and `accessor` do.
  expect(evaluated('class A { protected a: uint8 = 1; } String(new A().a);')).toBe('1');
  expect(evaluated('class A { protected readonly a: uint8 = 1; } String(new A().a);')).toBe('1');
  expect(evaluated('class A { static protected a: uint8 = 1; } String(A.a);')).toBe('1');
  // "A protected field participates in the layout exactly as a public one
  // does", so the field after it sits where it would have anyway.
  const withProtected = 'class A { a: uint8; protected b: uint32; c: uint8; } ';
  expect(evaluated(`${withProtected} String((type A).byteLength);`)).toBe('12');
  expect(evaluated(`${withProtected} String(Reflect.getReflection.<Reflect.ClassField, A>("c").offset);`)).toBe('8');
  // And a member NAMED `protected` still works, which is the hazard a
  // contextual keyword always carries.
  expect(evaluated('class A { protected = 5; } String(new A().protected);')).toBe('5');
});

test('`readonly` and `protected` are REPORTED, which they had never been', () => {
  // Both were read off an invented cast naming `Readonly` and `Access` - the
  // FIELD RECORD's spellings - where a FieldDefinition node carries `readonly`
  // and `protected`. So both reported FALSE for every field however it was
  // declared: the same failure as the `Accessor`/`accessor` branch stage 0
  // removed, and the same cause.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f readonly a: uint8 = 1; } String(c.readonly);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f protected a: uint8 = 1; } String(c.protected);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f a: uint8 = 1; } String(c.readonly) + "/" + String(c.protected);`)).toBe('false/false');
});

test('PINNED: what stage E does not do', () => {
  // `initial` and `metadata` are in ClassAccessorReflection and not in the
  // context. `metadata` is stage H of the decorators plan, absent from every
  // context; `initial` is the declared default, which the field context does
  // not carry either - so it is one change across both rather than an accessor
  // one.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.initial);`)).toBe('undefined');
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.metadata);`)).toBe('undefined');
  expect(evaluated(`${grab} class A { @f a: uint32 = 5; } String(c.initial);`)).toBe('undefined');
  // The `protected` ACCESS RULE is not enforced: README makes it "an access rule
  // checked where the static type is known", and nothing checks it yet. The
  // modifier parses, lays out, and reflects - which is what stage E needed.
  expect(evaluated('class B { protected a: uint8 = 1; } class D extends B { read() { return this.a; } } String(new D().read());')).toBe('1');
  expect(evaluated('class B { protected a: uint8 = 1; } const o = new B(); String(o.a);')).toBe('1');
});
