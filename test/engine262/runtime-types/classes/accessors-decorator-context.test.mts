import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-decorator-contexts (Decorator Contexts) - `Reflect.ClassAccessor`,
 * and the `protected` modifier it reports. Design: README.md, decorators.md.
 *
 * `Reflect.ClassAccessor` is the last of the class family of contexts, and the
 * one that needs a whole declaration form built to reach.
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
  // `metadata`, and `readonly` - see the `readonly accessor` test below.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.name);`)).toBe('a');
  expect(evaluated(`${grab} class A { @f static accessor a: uint32 = 5; } String(c.static);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.static);`)).toBe('false');
  expect(evaluated(`${grab} class A { @f protected accessor a: uint32 = 5; } String(c.protected);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.protected);`)).toBe('false');
  // `readonly` IS reported: `readonly accessor` is legal and means GETTER-ONLY,
  // so the modifier has to be visible to a decorator as well as enforced.
  // `ClassAccessorReflection` omits it, which would argue for asserting its
  // ABSENCE - but a modifier that parses and does nothing is worse than one
  // that is refused, since the declaration reads as a constraint and enforces
  // none.
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(Object.prototype.hasOwnProperty.call(c, "readonly"));`)).toBe('true');
  // The name is the DECLARED one, not the backing storage: the backing is
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
  // Read from INSIDE the class, since the access rule now refuses an outside
  // read - these assertions are about the member EXISTING and being reachable
  // where it should be, not about the rule.
  expect(evaluated('class A { protected a: uint8 = 1; read() { return this.a; } } String(new A().read());')).toBe('1');
  expect(evaluated('class A { protected readonly a: uint8 = 1; read() { return this.a; } } String(new A().read());')).toBe('1');
  expect(evaluated('class A { static protected a: uint8 = 1; static read() { return A.a; } } String(A.read());')).toBe('1');
  // And `protected` is NOT a runtime wall - an `any`-typed reference reads it,
  // "the erasure other languages apply to it".
  expect(evaluated('class A { protected a: uint8 = 1; } const x: any = new A(); String(x.a);')).toBe('1');
  // "A protected field participates in the layout exactly as a public one
  // does", so the field after it sits where it would have anyway.
  const withProtected = 'class A { a: uint8; protected b: uint32; c: uint8; } ';
  expect(evaluated(`${withProtected} String((type A).byteLength);`)).toBe('12');
  expect(evaluated(`${withProtected} String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("c").offset);`)).toBe('8');
  // And a member NAMED `protected` still works, which is the hazard a
  // contextual keyword always carries.
  expect(evaluated('class A { protected = 5; } String(new A().protected);')).toBe('5');
});

test('`readonly` and `protected` are REPORTED, which they had never been', () => {
  // Both were read off an invented cast naming `Readonly` and `Access` - the
  // FIELD RECORD's spellings - where a FieldDefinition node carries `readonly`
  // and `protected`. So both reported FALSE for every field however it was
  // declared: the same failure, and the same cause, as a context branch keyed
  // on a field name no parser sets.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f readonly a: uint8 = 1; } String(c.readonly);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f protected a: uint8 = 1; } String(c.protected);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f a: uint8 = 1; } String(c.readonly) + "/" + String(c.protected);`)).toBe('false/false');
});

test('what the accessor context does and does not carry', () => {
  // `initial` and `metadata` are in ClassAccessorReflection. `initial` is the
  // declared default, which the field context carries as well - one derivation
  // across both rather than an accessor-specific one.
  const grab = 'let c; function f(x) { c = x; } ';
  // `initial` is on both contexts.
  // decorators.md gives it on `ClassAccessorReflection` as well as
  // `ClassFieldReflection`, and the two describe the same declaration - so ONE
  // derivation serves both rather than two that can drift, which is the shape
  // this project has repeatedly been bitten by.
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.initial);`)).toBe('5');
  // A typed accessor with no initializer reports its type's ZERO VALUE.
  expect(evaluated(`${grab} class A { @f accessor a: uint32; } String(c.initial);`)).toBe('0');
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } typeof c.metadata;`)).toBe('object');
  // The plain FIELD context reports it too, from the SAME derivation - which is
  // the point of sharing one: a field and an accessor describe the same
  // declaration and cannot disagree about its declared default.
  expect(evaluated(`${grab} class A { @f a: uint32 = 5; } String(c.initial);`)).toBe('5');
  // The `protected` ACCESS RULE is not enforced: README makes it "an access rule
  // checked where the static type is known", and nothing checks it yet. The
  // modifier parses, lays out, and reflects.
  expect(evaluated('class B { protected a: uint8 = 1; } class D extends B { read() { return this.a; } } String(new D().read());')).toBe('1');
  // Through a `let`: a `const` bound to a construction is now typed, so
  // `o.a` from outside the class is refused as the protected access it is.
  // Reading it here is about the accessor's VALUE, so it goes through a binding
  // the checker does not type.
  expect(evaluated('class B { protected a: uint8 = 1; } let o = new B(); String(o.a);')).toBe('1');
});

test('an accessor context reports its TYPE', () => {
  // proposal-runtime-types #sec-reflection-shape-class gives ClassAccessor a
  // `type`, and the field context beside it always had one by reading the same
  // annotation. Without it an accessor's decorator could see its name, its
  // visibility, and its initial value, and not what it holds - which is the one
  // question the type system makes the facility for.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f accessor a: uint32 = 5; } String(c.type === uint32);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f accessor s: string = ""; } String(c.type === string);`)).toBe('true');
});

test('a method, getter, and setter context report `protected`', () => {
  // They reported `static` and `private` and not `protected`, where the field
  // and accessor contexts reported all three - two of three answers here and
  // three there, for no reason a reader could see.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f protected m(): uint8 { return 1; } } String(c.protected);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f m(): uint8 { return 1; } } String(c.protected);`)).toBe('false');
  expect(evaluated(`${grab} class A { @f protected get v(): uint8 { return 1; } } String(c.protected);`)).toBe('true');
  expect(evaluated(`${grab} class A { @f protected set v(x: uint8) {} } String(c.protected);`)).toBe('true');
});

// -- access over the accessor's own slot -----------------------------------------

test('the accessor context carries `access` over its own slot', () => {
  // decorators.md's replacement for `Reflect.ClassAccessor` is a `{ get, set }`
  // pair. A replacement that cannot reach the ORIGINAL storage has to close
  // over storage of its own, orphaning the layout slot the backing occupies -
  // so the context now hands the pair over, as TC39's `context.access` does.
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.access + "/" + typeof c.access.get + "/" + typeof c.access.set; } '
    + 'class A { @f accessor a: uint8 = 1; } t;')).toBe('object/function/function');
  // THE ASSERTION THAT MATTERS is that it reaches the REAL storage, both ways -
  // a pair that merely existed would satisfy a `typeof` check and still leave
  // the slot dead.
  expect(evaluated('let g; function f(c) { g = c.access; } class A { @f accessor a: uint8 = 5; } '
    + 'const o = new A(); o.a = 9; String(g.get.call(o));')).toBe('9');
  expect(evaluated('let g; function f(c) { g = c.access; } class A { @f accessor a: uint8 = 5; } '
    + 'const o = new A(); g.set.call(o, 3); String(o.a);')).toBe('3');
  // It follows the receiver rather than closing over one instance.
  expect(evaluated('let g; function f(c) { g = c.access; } class A { @f accessor a: uint8 = 5; } '
    + 'const x = new A(), y = new A(); x.a = 1; y.a = 2; String(g.get.call(x)) + "/" + String(g.get.call(y));')).toBe('1/2');
  // A plain field has no pair, so it has no `access`.
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.access; } class A { @f a: uint8 = 1; } t;')).toBe('undefined');
});
