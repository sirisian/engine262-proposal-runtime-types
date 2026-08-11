import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-reflection-shapes (Reflection Shapes).
 *
 * #sec-decorators specifies reflection and decoration as ONE facility, so
 * every context has a read half as well as a decoration half. The
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
  //
  // `constructor` is among them: a constructor is a `ClassMethod` of that name
  // (#table-reflection-contexts), and a class always has one, the default being
  // what `new` calls where none is written.
  expect(evaluated('class A { m() {} n() {} } Object.keys(Reflect.getReflection.<Reflect.ClassMethod, A>()).sort().join(",");')).toBe('constructor,m,n');
  // "Reflection includes inherited members BY DEFAULT."
  expect(evaluated('class B { base() {} } class D extends B { own() {} } '
    + 'Object.keys(Reflect.getReflection.<Reflect.ClassMethod, D>()).sort().join(",");')).toBe('base,constructor,own');
  // "To query only the members a class declares itself, pass `{ own: true }`."
  expect(evaluated('class B { base() {} } class D extends B { own() {} } '
    + 'Object.keys(Reflect.getReflection.<Reflect.ClassMethod, D>({ own: true })).sort().join(",");')).toBe('constructor,own');
  // The CONTEXT filters the kind, so a getter is not among the methods.
  expect(evaluated('class A { m() {} get v(): uint8 { return 1; } } '
    + 'Object.keys(Reflect.getReflection.<Reflect.ClassGetter, A>()).join(",");')).toBe('v');
  // A REDECLARATION SHADOWS rather than doubling: the chain is walked from the
  // derived class outward and a name already seen is not replaced, which is the
  // same direction the metadata prototype chain resolves in. Counting is what
  // catches the other order - both would contain `m`.
  // Counted over `m` alone, `constructor` being present for every class and so
  // not what this is measuring.
  expect(evaluated('class B { m() {} } class D extends B { m() {} } '
    + 'String(Object.keys(Reflect.getReflection.<Reflect.ClassMethod, D>())'
    + '.filter((k) => k === "m").length);')).toBe('1');
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
  // decorators.md declares it only for the
  // PARAMETER contexts, and it returns a LIST indexed by position - which is
  // what separates it from the enumerating forms, whose result is keyed by
  // name.
  const m = 'class A { m(a: uint8, b: uint8) {} } ';
  expect(evaluated(`${m} const p = Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>("m"); `
    + 'String(p.length) + "/" + p[0].name + "/" + p[1].name;')).toBe('2/a/b');
  expect(evaluated(`${m} String(Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>("m")[1].index);`)).toBe('1');
  // `initial` and `initializer`, the pair a field and an accessor already
  // carry. `initial` is "a typed field's zero value, or a constant
  // initializer", so an annotated parameter with no default reports the zero of
  // its type rather than *undefined* - which is why the presence of a default
  // is read from `initializer` and not from `initial` being absent. A `hasDefault` Boolean stood here on the reasoning that a default is
  // "an expression evaluated PER CALL, so what can be reported is whether one
  // was written" - true of a NON-CONSTANT default, and decorators.md ~330 adds
  // the branch it leaves out: `initial` captures constant values only, and
  // `initializer` carries the declaration either way. `hasDefault` was then
  // `initializer !== undefined`, a third field reporting what a second implies.
  expect(evaluated('class A { m(a: uint8, b: uint8 = 2) {} } '
    + 'const p = Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>("m"); '
    + 'String(p[0].initial) + "/" + String(p[1].initial);')).toBe('0/2');
  expect(evaluated('class A { m(a: uint8, b: uint8 = 2) {} } '
    + 'const p = Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>("m"); '
    + 'String(p[0].initializer !== undefined) + "/" + String(p[1].initializer !== undefined);')).toBe('false/true');
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

// -- The field layout context ----------------------------------------------------

/**
 * `offset` and `byteLength` on a field's decorator context.
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

// -- The method context type -----------------------------------------------------

/**
 * `type` on `ClassMethodReflection`.
 *
 * decorators.md gives a method's context its declared RETURN type. The builder
 * took no NODE at all, which is why it could not report one - it was handed a
 * kind, a key and a flag, none of which knows the declaration.
 */

test('a method context reports its FUNCTION type', () => {
  // decorators.md: `ClassMethodReflection<T extends (...args) => any>` has
  // `type: T`, and `ClassGetterReflection` has `type: () => T`. BOTH ARE THE
  // MEMBER'S FUNCTION TYPE, not its return type. Reporting the return instead
  // would make a getter's `type` indistinguishable from its RETURN
  // sub-target's.
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
    .toBe('kind,name,static,private,protected,abstract,type,signatures,classContext,metadata,addInitializer');
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

// -- Method signatures -----------------------------------------------------------

/**
 * `signatures` on `ClassMethodReflection`.
 *
 * decorators.md: "signatures: [].<FunctionSignatureReflection> - Length 1 when
 * not overloaded", where a `FunctionSignatureReflection` is
 * `{ parameters, return }`.
 */

test('a method reports ONE signature', () => {
  // "Length 1 when not overloaded" - and a CLASS METHOD is never overloaded in
  // this engine: a second declaration of one name REPLACES the first. A
  // FUNCTION declaration does form an overload group, which is what makes this
  // a property of the position rather than of the language.
  expect(evaluated(`${GRAB} class A { @g m(): uint8 { return uint8(1); } } String(ctx.signatures.length);`)).toBe('1');
  expect(evaluated('class A { m(x: uint8) { return 1; } m(x: string) { return 2; } } '
    + 'const a = new A(); String(a.m(uint8(1)));')).toBe('2');
  expect(evaluated('function f(x: uint8) { return 1; } function f(x: string) { return 2; } '
    + 'String(f(uint8(1)));')).toBe('1');
});

test('a signature carries its PARAMETERS, each fully described', () => {
  const M = `${GRAB} class A { @g m(a: uint8, x: uint32 = 7): uint8 { return uint8(1); } } `;
  expect(evaluated(`${M} String(ctx.signatures[0].parameters.length);`)).toBe('2');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[1].name);`)).toBe('x');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[1].index);`)).toBe('1');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[1].type === (type uint32));`)).toBe('true');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[1].initial);`)).toBe('7');
  // The first parameter is described independently - so this is read per
  // parameter rather than one description repeated.
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[0].type === (type uint8));`)).toBe('true');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[0].initial);`)).toBe('undefined');
  // A method with no parameters has an empty list, not an absent one.
  expect(evaluated(`${GRAB} class A { @g m(): uint8 { return uint8(1); } } String(ctx.signatures[0].parameters.length);`)).toBe('0');
});

test('a signature carries its RETURN', () => {
  expect(evaluated(`${GRAB} class A { @g m(): uint8 { return uint8(1); } } String(ctx.signatures[0].return.type === (type uint8));`)).toBe('true');
  expect(evaluated(`${GRAB} class A { @g m(): string { return ""; } } String(ctx.signatures[0].return.type === (type string));`)).toBe('true');
  // An unannotated return reports no type rather than inventing one.
  expect(evaluated(`${GRAB} class A { @g m() {} } String(ctx.signatures[0].return.type);`)).toBe('undefined');
});

test('the signature agrees with the PARAMETER CONTEXT about one declaration', () => {
  // Both are read from the same node, which is what stops two reflections of
  // one parameter from disagreeing - the failure this plan has met repeatedly.
  const P = 'let p; function h(c) { p = c; } ';
  expect(evaluated(`${GRAB}${P} class A { @g m(@h x: uint32 = 7) {} } `
    + 'String(p.name === ctx.signatures[0].parameters[0].name);')).toBe('true');
  expect(evaluated(`${GRAB}${P} class A { @g m(@h x: uint32 = 7) {} } `
    + 'String(p.type === ctx.signatures[0].parameters[0].type);')).toBe('true');
  expect(evaluated(`${GRAB}${P} class A { @g m(@h x: uint32 = 7) {} } `
    + 'String(p.initial === ctx.signatures[0].parameters[0].initial);')).toBe('true');
});

// -- The parameter context -------------------------------------------------------

/**
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
    + 'class A { m(@g x: uint32) {} } return f; })();')).toBe('kind,index,name,type,initial,initializer,metadata,methodContext');
  // `index` still identifies WHICH parameter.
  expect(evaluated('(() => { let i; function g(c) { i = c.index; } '
    + 'class A { m(a: uint8, @g x: uint32) {} } return String(i); })();')).toBe('1');
  // A RETURN sub-target carries no index - "a parameter carries its `index`; a
  // return does not, which is what distinguishes the two beyond the context
  // type" - and no `name` or `initial`, which a return has not got. It DOES
  // carry `type`: the annotated type itself, where the owning member's `type`
  // is the whole FUNCTION type.
  expect(evaluated('(() => { let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } '
    + 'class A { m(): @g uint8 { return uint8(1); } } return f; })();')).toBe('kind,type,metadata,methodContext');
});

test('a parameter carries METADATA, keyed by method AND position', () => {
  // decorators.md's `ClassMethodParameterMetadata`. A parameter is identified
  // by its method and index, so the key names both - which is what makes the
  // next three assertions come out the way they do.
  expect(evaluated('(() => { let p; function g(c) { p = c; } '
    + 'class A { m(@g x: uint32) {} } return typeof p.metadata; })();')).toBe('object');
  expect(evaluated('(() => { let p; function g(c) { p = c; } '
    + 'class A { m(@g x: uint32) {} } p.metadata.tag = 1; return String(p.metadata.tag); })();')).toBe('1');
  // TWO PARAMETERS of one method do not share; the SAME index on two methods
  // does not share; and two decorators on ONE parameter DO - which is the
  // property the key exists for.
  expect(evaluated('(() => { let a, b; function g1(c) { a = c; } function g2(c) { b = c; } '
    + 'class A { m(@g1 x: uint8, @g2 y: uint8) {} } return String(a.metadata === b.metadata); })();')).toBe('false');
  expect(evaluated('(() => { let a, b; function g1(c) { a = c; } function g2(c) { b = c; } '
    + 'class A { m(@g1 x: uint8) {} n(@g2 y: uint8) {} } return String(a.metadata === b.metadata); })();')).toBe('false');
  expect(evaluated('(() => { let a, b; function g1(c) { a = c; } function g2(c) { b = c; } '
    + 'class A { m(@g1 @g2 x: uint8) {} } return String(a.metadata === b.metadata); })();')).toBe('true');
});

test('a parameter\'s metadata PROTOTYPE-LINKS to the base class\'s', () => {
  // The same rule a member's metadata follows: a derived class's same parameter
  // READS the base's through the prototype while being a DISTINCT object, so a
  // subclass can add without disturbing what it inherited.
  expect(evaluated('(() => { let base, derived; function b(c) { base = c; } function d(c) { derived = c; } '
    + 'class B { m(@b x: uint8) {} } base.metadata.tag = "from-base"; '
    + 'class D extends B { m(@d x: uint8) {} } return String(derived.metadata.tag); })();')).toBe('from-base');
  expect(evaluated('(() => { let base, derived; function b(c) { base = c; } function d(c) { derived = c; } '
    + 'class B { m(@b x: uint8) {} } class D extends B { m(@d x: uint8) {} } '
    + 'return String(base.metadata === derived.metadata); })();')).toBe('false');
});

// -- The read path agrees with the decorator context -----------------------------

/**
 * The READ PATH reports a member's `type`, and reports the SAME type the
 * decorator context does.
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

// -- What each reflection shape reports ------------------------------------------

test('the layout reflection says which field it describes', () => {
  // Reached by `Reflect.ClassFieldLayout` since the two views were split: the
  // placement is its own context, and `Reflect.ClassField` answers what the
  // field was DECLARED as (#sec-reflection-shape-class-field-layout).
  //
  // `getReflection.<Reflect.ClassFieldLayout, T>(name)` reported only layout numbers.
  // Redundant when fetched BY name, necessary when the set is enumerated -
  // which is the form that reads a whole layout out - and the design's
  // ClassFieldReflection lists `name` either way.
  expect(evaluated('class A { a: uint8; b: uint16; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").name);')).toBe('b');
  // The bit-field surface stays where it is and is the memory-layout
  // extension's own reflection. It carries no `static`, `private`, or
  // `protected`: those are facts about the DECLARATION, which the ClassField
  // reflection reports, and duplicating them here is what let the two shapes
  // look like variants of one thing rather than answers to different questions.
  expect(evaluated('class A { a: uint8; b: uint16; } Object.keys(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b")).join(",");'))
    .toBe('kind,name,offset,byteLength,bitLength,alignment,offsetBit,isBitField');
});

test('a binding reflection reports `initial`, not `value`', () => {
  // The binding above is unannotated, so it reports no `type` - a member that
  // annotates nothing reports nothing rather than a type of `any`, which is how
  // the field and method contexts already read an absent annotation.
  //
  // decorators.md's LetReflection and ConstReflection both name this `initial`,
  // and the name is the accurate one: a decorator sees what the binding was
  // DECLARED with, not a live view. `value` implied a liveness the object never
  // had - a `let` reassigned later still reports what it started with.
  expect(evaluated('let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } @g let x = 41; f;')).toBe('kind,name,initializer,initial');
  expect(evaluated('let v; function g(c) { v = c.initial; } @g let x = 41; String(Number(v));')).toBe('41');
  expect(evaluated('let v; function g(c) { v = c.initial; } @g const y = 7; String(Number(v));')).toBe('7');
  // The reassignment case, which is what makes the name a claim rather than a
  // preference: the reflection keeps the declared value.
  expect(evaluated('let v; function g(c) { v = c.initial; } @g let x = 41; x = 99; String(Number(v)) + "/" + String(x);')).toBe('41/99');
});

test('an operator context says WHICH operator, and carries its type', () => {
  // #sec-reflection-shape-class: ClassOperator reports
  // `operator`, `type`, and `signatures`. It reported none of the three - the
  // call site alone withheld the declaration node the other two are derived
  // from, and nothing read the operator name at all. An operator reflection
  // that cannot say which operator it is has lost what distinguishes it from a
  // method's.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class V { @f operator +(o: V): V { return o; } } String(c.operator);`)).toBe('+');
  expect(evaluated(`${grab} class V { @f operator -(o: V): V { return o; } } String(c.operator);`)).toBe('-');
  expect(evaluated(`${grab} class V { @f operator +(o: V): V { return o; } } String(c.signatures.length);`)).toBe('1');
  expect(evaluated(`${grab} class V { @f operator +(o: V): V { return o; } } String(typeof c.type);`)).toBe('object');
});

test('a binding context reports its declared type and its initializer', () => {
  // #sec-reflection-shape-binding gives Let and Const a `type` and an
  // `initializer` beside `initial`. They had neither, so a binding's decorator
  // could see what the binding started with and not what it was declared AS.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} @f let v: uint32 = 3; String(c.type === uint32);`)).toBe('true');
  expect(evaluated(`${grab} @f const k: string = "s"; String(c.type === string);`)).toBe('true');
  expect(evaluated(`${grab} @f let v: uint32 = 3; String(typeof c.initializer);`)).toBe('object');
  // An unannotated binding reports no type, rather than a type of `any`.
  expect(evaluated(`${grab} @f let u = 1; String(Object.getOwnPropertyNames(c).includes('type'));`)).toBe('false');
});

test('a function context reports its signatures', () => {
  // #sec-reflection-shape-function: the Function
  // reflection is the ONE place the whole set of signatures is reachable - a
  // FunctionParameter context reflects the one signature its decoration was
  // written on. Without it an overloaded function reflected as though it had
  // one signature, and a reader had nowhere else to look.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} @f function q(a: uint8): uint8 { return a; } String(c.signatures.length);`)).toBe('1');
  expect(evaluated(`${grab} @f function q(a: uint8): uint8 { return a; } String(c.signatures[0].parameters.length);`)).toBe('1');
  expect(evaluated(`${grab} @f function q(): uint8 { return 1; } String(c.signatures[0].parameters.length);`)).toBe('0');
});

test('an enum reports its size, and an enumerator its value and index', () => {
  // #sec-reflection-shape-enum. The Enum context carried
  // only name, type, and metadata, and the enumerator carried a `type` that was
  // the enum's Type Object repeated once per member. An enumerator reflection
  // that cannot report its value has lost its subject.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} @f enum E { A, B, C } String(c.size);`)).toBe('3');
  expect(evaluated(`${grab} @f enum E { A } String(c.name);`)).toBe('E');
  expect(evaluated(`${grab} enum E { A, @f B } String(c.index);`)).toBe('1');
  expect(evaluated(`${grab} enum E { A, @f B } String(c.value);`)).toBe('1');
  // `index` is DECLARATION ORDER, which is not the value where a program
  // assigns values explicitly.
  expect(evaluated(`${grab} enum E { A = 10, @f B = 20 } String(c.index) + '/' + String(c.value);`)).toBe('1/20');
  // No `type` on an enumerator: it is the enum's, reached through the enum.
  expect(evaluated(`${grab} enum E { @f A } String(Object.getOwnPropertyNames(c).includes('type'));`)).toBe('false');
});

test('a Tuple or Record reflection is just its type', () => {
  // #sec-reflection-shape-structural: these reflect a
  // composite VALUE where Reflect.Type reflects a type, and their whole shape is
  // `type` - no name, no metadata, the Structural family being one of those
  // #sec-decorator-metadata gives none. They were being built by the object
  // member builder and carried all three.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} const e = @f Composite([0]); Object.keys(c).sort().join(',');`)).toBe('kind,type');
  expect(evaluated(`${grab} const d = @f Composite({ a: 1 }); Object.keys(c).sort().join(',');`)).toBe('kind,type');
  // Which context fires is decided by the VALUE, not the syntax.
  expect(evaluated(`${grab} const e = @f Composite([0]); c.kind;`)).toBe('Tuple');
  expect(evaluated(`${grab} const d = @f Composite({ a: 1 }); c.kind;`)).toBe('Record');
});

test('an Object reflection has no name, and a setter parameter no index', () => {
  // An object literal has no name to report: the language names an anonymous
  // function or class from its binding and pointedly not an object literal, and
  // a name from the binding would report where the value went rather than what
  // it is. It read undefined in every position anyway.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} const o = @f { a: 1 }; String(Object.getOwnPropertyNames(c).includes('name'));`)).toBe('false');
  // A setter takes exactly one parameter, so an index that is always 0 reports
  // nothing. Every other parameter reflection keeps its index.
  expect(evaluated(`${grab} class A { set v(@f x: uint8) {} } String(Object.getOwnPropertyNames(c).includes('index'));`)).toBe('false');
  expect(evaluated(`${grab} class A { m(@f x: uint8) {} } String(c.index);`)).toBe('0');
});

test('an object method, getter, and setter report their type', () => {
  // #sec-reflection-shape-object: the family mirrors the
  // Class family member for member, and five of its nine contexts answered
  // nothing about what they hold - the builder took no declaration node, so it
  // could not read the annotation the Class family reads for the same shapes.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} const o = { @f m(x: uint8): uint8 { return x; } }; String(typeof c.type);`)).toBe('object');
  expect(evaluated(`${grab} const o = { @f get v(): uint8 { return 1; } }; String(typeof c.type);`)).toBe('object');
  expect(evaluated(`${grab} const o = { @f set v(x: uint8) {} }; String(typeof c.type);`)).toBe('object');
  // An ObjectMethod reports its signatures, as a class method does.
  expect(evaluated(`${grab} const o = { @f m(x: uint8): uint8 { return x; } }; String(c.signatures.length);`)).toBe('1');
  expect(evaluated(`${grab} const o = { @f m(x: uint8): uint8 { return x; } }; String(c.signatures[0].parameters.length);`)).toBe('1');
});

test('an object field reports the type of the value it holds', () => {
  // An object literal's field carries no annotation: `{ a: uint8 = 1 }` parses
  // as the property `a` holding the ASSIGNMENT EXPRESSION `uint8 = 1`, which is
  // why `{ a: uint8 = 300 }` stores 300 rather than refusing it. So the type a
  // field reports is the type of its value - the answer that suits a family
  // reached from an INSTANCE rather than from a declaration.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} const o = { @f a: "s" }; String(c.type === string);`)).toBe('true');
  expect(evaluated(`${grab} const o = { @f a: true }; String(c.type === boolean);`)).toBe('true');
  // A typed value keeps its type through the literal.
  expect(evaluated(`${grab} let v: uint8 = 3; const o = { @f a: v }; String(c.type === uint8);`)).toBe('true');
});

test('a getter and setter carry no `signatures`', () => {
  // #sec-reflection-shape-class gives `signatures` to a method and an operator
  // and not to a getter or setter: a getter has exactly one signature and takes
  // no parameters, so a List of one is ceremony rather than information, and
  // `type` already reports the function type.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f get v(): uint8 { return 1; } } String(Object.getOwnPropertyNames(c).includes('signatures'));`)).toBe('false');
  expect(evaluated(`${grab} class A { @f set v(x: uint8) {} } String(Object.getOwnPropertyNames(c).includes('signatures'));`)).toBe('false');
  // A method and an operator keep theirs.
  expect(evaluated(`${grab} class A { @f m(): uint8 { return 1; } } String(c.signatures.length);`)).toBe('1');
  expect(evaluated(`${grab} class V { @f operator +(o: V): V { return o; } } String(c.signatures.length);`)).toBe('1');
});

test('the declaration and the layout are two contexts, not one', () => {
  // #sec-reflection-shape-class-field-layout. One
  // retrieval expression used to answer two shapes: memorylayout.md reached a
  // field's placement through Reflect.ClassField and decorators.md named its
  // decorator context by the same expression, so which shape a reader got
  // depended on which document was open.
  const V = 'class V { x: uint32 = 1; y: uint8 = 2; } ';
  // The declaration view: what the field WAS DECLARED as.
  expect(evaluated(`${V} Reflect.getReflection.<Reflect.ClassField, V>('x').kind;`)).toBe('ClassField');
  expect(evaluated(`${V} String(Object.getOwnPropertyNames(Reflect.getReflection.<Reflect.ClassField, V>('x')).includes('type'));`)).toBe('true');
  // The layout view: where its bytes are, and none of the declaration facts the
  // other reports.
  expect(evaluated(`${V} Reflect.getReflection.<Reflect.ClassFieldLayout, V>('y').kind;`)).toBe('ClassFieldLayout');
  expect(evaluated(`${V} String(Reflect.getReflection.<Reflect.ClassFieldLayout, V>('y').offset);`)).toBe('4');
  expect(evaluated(`${V} String(Object.getOwnPropertyNames(Reflect.getReflection.<Reflect.ClassFieldLayout, V>('y')).includes('private'));`)).toBe('false');
  // They answer differently for a class with no layout, and both are right: the
  // declaration reflection reports no placement, and asking the layout one at
  // all is the mistake.
  expect(evaluated(`class U { a: uint8; b; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, U>('a').offset);`)).toBe('undefined');
});

test('an enum reports the type its enumerators take their values in', () => {
  // Closes the enum family. #sec-reflection-shape-enum gives the Enum
  // reflection a `valueType`, and it read undefined: the declaration resolves
  // the annotation and stores it as the record's Underlying, and nothing had
  // ever read it back out.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} @f enum E: uint8 { A } String(c.valueType === uint8);`)).toBe('true');
  expect(evaluated(`${grab} @f enum C: float32 { Zero } String(c.valueType === float32);`)).toBe('true');
  // It reports the DEFAULT where the program wrote no annotation, so a reader
  // need not know whether one was written. #sec-enums: "an enum declared
  // without one has the underlying type int32" - this defaulted to `number`.
  expect(evaluated(`${grab} @f enum D { A } String(c.valueType === int32);`)).toBe('true');
});
