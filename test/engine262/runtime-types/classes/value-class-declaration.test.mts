import { test, expect } from 'vitest';
import {
  evaluated, expectThrown, observeScript,
} from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';

/**
 * A class is a value where it is declared one (#sec-value-classes).
 *
 * "A class declared `value` is a value type class, and no other class is. The declaration decides. What
 * a class holds does not: a class every field of which has a value type is held by reference unless it
 * is declared `value`."
 *
 * It was derived from the fields: a typed class every field of which had a value type was a value type
 * class. So the last annotation added to a class changed what every use of it meant, and so did a field
 * added later, a base, a type argument and, for `class K extends pick(c)`, a value computed while the
 * program ran - each accepted, and none saying anything about copying. The ordinary class of the base
 * language, a counter, a model or a list node, stopped being one object when its fields were typed.
 */

const refused = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-value-class' } };
const tail = "function f() { const a = new P(); const b = a; b.x = 5; const u: any = { x: new P(), y: new P() }; return String(a.x) + String(b.x) + String(u.x === u.y) + String(new Set([new P(), new P()]).size); } f();";

test('a class declared value is copied and compared by its fields, and one that is not is one object', () => {
  expect(evaluated(`value class P { x: uint8 = 0; s: string = ''; } ${tail}`)).toBe('05true1');
  expect(evaluated(`class P { x: uint8 = 0; s: string = ''; } ${tail}`)).toBe('55false2');
  // The annotations decide nothing: none, some and all of them give the same answer.
  expect(evaluated(`class P { x = 0; s = ''; } ${tail}`)).toBe('55false2');
  expect(evaluated(`class P { x: uint8 = 0; s = ''; } ${tail}`)).toBe('55false2');
  // A class that is not a value class is typed and sealed all the same.
  expect(evaluated('class P { x: uint8 = 0; } const p = new P(); String(Object.isExtensible(p)) + String(Object.isFrozen(Object.getPrototypeOf(p)));')).toBe('falsetrue');
  expectThrown("class P { x: uint8 = 0; } const u: any = new P(); u.x = 'a';", 'is not a conversion source');
});

test('typing the fields of a class does not change which object a name refers to', () => {
  // An untyped function is handed the object, as it is for an untyped class.
  expect(evaluated("class User { id: number = 0; name: string = ''; } function rename(u, n) { u.name = n; } const u = new User(); rename(u, 'Ada'); u.name;")).toBe('Ada');
  expect(evaluated("class User { id: number = 0; name: string = ''; } function rename(u: User, n: string) { u.name = n; } const u = new User(); rename(u, 'Ada'); u.name;")).toBe('Ada');
  // A method that stores to `this` reaches the caller's object, with a public field and with a private one.
  expect(evaluated('class Counter { n: uint32 = 0; inc() { this.n += 1; } } function tick(c: Counter) { c.inc(); } function g() { const c = new Counter(); tick(c); tick(c); return String(c.n); } g();')).toBe('2');
  expect(evaluated('class Counter { #n: uint32 = 0; inc() { this.#n += 1; } get value(): uint32 { return this.#n; } } function tick(c: Counter) { c.inc(); } function g() { const c = new Counter(); tick(c); tick(c); return String(c.value); } g();')).toBe('2');
  // A holder sees what its model becomes.
  expect(evaluated('class Model { count: number = 0; } class View { model: Model; constructor(m: Model) { this.model = m; } } function g() { const m = new Model(); const v = new View(m); m.count = 3; return String(v.model.count); } g();')).toBe('3');
  // A class that holds itself is a list node, and the two classes that hold each other are two classes.
  expect(evaluated('class Node { v: uint8 = 0; next: Node | null = null; } function f() { const a = new Node(); const b = new Node(); b.v = 7; a.next = b; return String(a.next?.v); } f();')).toBe('7');
  expect(evaluated('class A { b: B | null = null; } class B { a: A | null = null; } String(new A().b);')).toBe('null');
});

test('a field added to a class changes nothing elsewhere, and is refused where the class is a value', () => {
  const use = "function f() { const s = new Settings(); const before = s; s.volume = 3; const m = new Map(); m.set(new Settings(), 1); const u: any = { a: new Settings(), b: new Settings() }; return String(before.volume) + String(u.a === u.b) + String(m.get(new Settings())); } f();";
  expect(evaluated(`class Settings { volume: uint8 = 0; name: string = ''; } ${use}`)).toBe('3falseundefined');
  expect(evaluated(`class Settings { volume: uint8 = 0; name: string = ''; tags: [].<string> = []; } ${use}`)).toBe('3falseundefined');
  expect(evaluated(`value class Settings { volume: uint8 = 0; name: string = ''; } ${use}`)).toBe('0true1');
  expect(observeScript(`value class Settings { volume: uint8 = 0; name: string = ''; tags: [].<string> = []; } ${use}`)).toMatchObject(refused);
});

test('the declaration is checked against its fields', () => {
  // No type, and a type that is not a value type: an array that grows, an object, a function, `any`,
  // a collection, and a class that is not a value class.
  expect(observeScript('value class C { a: uint8 = 0; b = 1; }')).toMatchObject(refused);
  for (const type of ['[].<uint8>', 'object', '() => uint8', 'any', 'Conn', 'Conn | null', '[Conn, uint8]', '[2].<Conn>', 'Named']) {
    expect(observeScript(`class Conn { id: uint8 = 1; } interface Named { name: string; } value class C { a: uint8 = 0; b: ${type}; constructor(b: any) { this.b = b; } }`), type).toMatchObject(refused);
  }
  // A type the checking pass cannot place is judged when the class is evaluated, which has the type.
  expectThrown('value class C { a: uint8 = 0; b: Map.<string, uint8>; constructor(b: any) { this.b = b; } }', 'its field "b" has a type that is not a value type');
  expect(evaluated('type Small = uint8 where this < 10; value class K { a: Small = 5; } function f() { const k = new K(); const j = k; j.a = 6; return String(k.a) + String(j.a); } f();')).toBe('56');
  // What a value type is has not changed (classes/value-class-without-layout.test.mts).
  for (const field of ['b: string', 'b: bigint', "b: 'a' | 'b' = 'a'", 'b: uint8 | string = 1', 'b: V', 'b: V | null', 'b: [2].<V>', 'b: [V, string]', 'b: E = E.A']) {
    expect(evaluated(`enum E { A, B } value class V { n: uint8 = 0; } value class C { a: uint8 = 0; ${field}; } function f() { const c = new C(); const d = c; d.a = 5; return String(c.a) + String(d.a); } f();`), field).toBe('05');
  }
  // The message names the class and the field.
  expectThrown('value class C { a: uint8 = 0; xs: [].<uint8> = []; }', 'C" is a value class, and its field "xs"');
});

test('and against its base', () => {
  // A class that extends a value class is one, and says so.
  expect(observeScript('value class A { a: uint8 = 0; } class B extends A { b: uint8 = 0; }')).toMatchObject(refused);
  expectThrown('value class A { a: uint8 = 0; } class B extends A { }', 'is written `value class`');
  // A value class extends nothing or a value class.
  expect(observeScript('class Counter { n: uint8 = 0; } value class F extends Counter { }')).toMatchObject(refused);
  expectThrown('class U { } value class F extends U { x: uint8 = 0; }', 'its base is not one');
  expectThrown('value class E extends Error { status: uint16 = 0; }', 'its base is not one');
  // The kind is inherited by saying so, with the base's fields.
  expect(evaluated('value class A { a: uint8 = 0; } value class Q extends A { get twice(): uint8 { return this.a * 2; } } function f() { const q = new Q(); const r = q; r.a = 4; return String(q.a) + String(r.twice); } f();')).toBe('08');
  // A value class with no field of its own is typed by being one.
  expect(evaluated('value class Unit { } function f() { const u: any = { a: new Unit(), b: new Unit() }; return String(u.a === u.b) + String(Object.isExtensible(u.a)); } f();')).toBe('truefalse');
});

test('a mixin says its kind, and its base is judged when it is applied', () => {
  const P = 'value class P { x: uint8 = 0; } class U { u: uint8 = 0; } ';
  const use = 'function f() { const a = new K(); const b = a; b.n = 5; return String(a.n) + String(b.n); } f();';
  expect(evaluated(`${P}const Tagged = (B) => value class extends B { t: uint8 = 0; }; value class K extends Tagged(P) { n: uint8 = 0; } ${use}`)).toBe('05');
  expectThrown(`${P}const Tagged = (B) => value class extends B { t: uint8 = 0; }; Tagged(U);`, 'its base is not one');
  expect(evaluated(`${P}const Tagged = (B) => class extends B { t: uint8 = 0; }; class K extends Tagged(U) { n: uint8 = 0; } ${use}`)).toBe('55');
  expectThrown(`${P}const Tagged = (B) => class extends B { t: uint8 = 0; }; Tagged(P);`, 'is written `value class`');
});

test('a type parameter that is a field type is bounded by value, so a generic class is one kind', () => {
  // The bound is implied where a field's type mentions the parameter (value-class-bounds.test.mts),
  // and may be written. Either way `Box` is a value at every argument it accepts.
  expect(observeScript('value class Box<T: type> { v: T; constructor(v: T) { this.v = v; } }').errorClass).toBeUndefined();
  // A bound that is written and is not a value type is refused.
  expect(observeScript('value class Box<T: type extends any> { v: T; constructor(v: T) { this.v = v; } }')).toMatchObject(refused);
  expectThrown('value class Box<T: type extends any> { v: T; constructor(v: T) { this.v = v; } }', 'whose bound "any" is not a value type');
  // A parameter of an enclosing function is not the class's to bound.
  expectThrown('function make<T: type>(saved: T) { return value class { v: T = saved; }; }', 'bound it with `extends value`');
  const B = 'value class Box<T: type extends value> { v: T; constructor(v: T) { this.v = v; } } ';
  expect(evaluated(`${B}function f() { const a = new Box.<uint8>(1); const b = a; b.v = 2; const s = new Box.<string>('s'); const t = s; t.v = 't'; return String(a.v) + String(b.v) + s.v + t.v; } f();`)).toBe('12st');
  expect(observeScript(`class Conn { id: uint8 = 1; } ${B}new Box.<Conn>(new Conn());`))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-generic-constraint' } });
  // A class that is to hold either is not a value class, and is one object at every argument.
  expect(evaluated("class Conn { id: uint8 = 1; } class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } function put<T: type>(b: Box.<T>, v: T) { b.v = v; } function f() { const a = new Box.<uint8>(1); put.<uint8>(a, 9); const c = new Box.<Conn>(new Conn()); const d = new Conn(); d.id = 7; put.<Conn>(c, d); return String(a.v) + String(c.v.id); } f();")).toBe('97');
});

test('the kind is read from the head, so a store to a copy is judged where the fields could not say', () => {
  const lost = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } };
  // A generic class, which was two kinds by its argument and was not judged.
  expect(observeScript('value class Box<T: type extends value> { v: T; constructor(v: T) { this.v = v; } } function put(b: Box.<uint8>, v: uint8) { b.v = v; } put(new Box.<uint8>(1), 2);')).toMatchObject(lost);
  // A class whose base is computed, whose kind was settled when the program ran.
  expect(observeScript('value class P { x: uint8 = 0; } const mix = (B) => value class extends B { t: uint8 = 0; }; value class K extends mix(P) { n: uint8 = 0; } function set(k: K) { k.n = 5; } set(new K());')).toMatchObject(lost);
  // And where the class is not a value the store lands.
  expect(evaluated('class P { x: uint8 = 0; } const mix = (B) => class extends B { t: uint8 = 0; }; class K extends mix(P) { n: uint8 = 0; } function set(k: K) { k.n = 5; } function g() { const k = new K(); set(k); return String(k.n); } g();')).toBe('5');
});

test('value combines with no other kind and shares a line with what follows it', () => {
  for (const head of ['sealed value class', 'value sealed class', 'value abstract class', 'value dynamic class', 'value partial class', 'value value class']) {
    expect(observeScript(`${head} P { x: uint8 = 0; }`), head).toMatchObject({ bodyEntered: false, errorClass: 'SyntaxError' });
  }
  // `value` is an identifier everywhere else, and at the end of a line.
  expect(evaluated('const value = 1; const y = value\nclass Foo { }\nString(y) + typeof Foo;')).toBe('1function');
  expect(evaluated('let value = 2; value = value + 1; function f(value: uint8): uint8 { return value; } String(value) + String(f(4));')).toBe('34');
  // A class expression takes the word too.
  expect(evaluated('const P = value class { x: uint8 = 0; }; function f() { const a = new P(); const b = a; b.x = 5; return String(a.x); } f();')).toBe('0');
  // The modifier that said the opposite is gone: a class says when it is a value.
  expect(observeScript('reference class P { x: uint8 = 0; }')).toMatchObject({ bodyEntered: false, errorClass: 'SyntaxError' });
});

test('where the word is forgotten the class behaves as a class does, and says so where it matters', () => {
  expect(observeScript('class P { x: uint8 = 0; } let p: P;')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-missing-default' } });
  expect(evaluated('value class P { x: uint8 = 0; } let p: P; String(p.x);')).toBe('0');
  expectThrown('class P { x: uint8 = 0; } P.byteLength;', 'has no layout');
  expect(evaluated('class P { x: uint8 = 0; } value class V { x: uint8 = 0; } String(P.hasLayout) + String(V.hasLayout) + String(V.byteLength) + String(Reflect.isAssignable(P, value)) + String(Reflect.isAssignable(V, value));')).toBe('falsetrue1falsetrue');
  // It is held weakly, having an identity, and a value class is not.
  expect(evaluated('class P { x: uint8 = 0; } function f() { const w = new WeakMap(); const p = new P(); w.set(p, 1); return String(w.get(p)); } f();')).toBe('1');
  expectThrown('value class P { x: uint8 = 0; } function f() { const w = new WeakMap(); const u: any = new P(); w.set(u, 1); } f();', 'cannot be weakly referenced');
});

test('a class with a modifier is exported and decorated as a class with none is', async () => {
  // `export sealed class P { }` was a SyntaxError: the module grammar looked for `class` and found
  // a word, whatever the modifier. After `export default` a class with a modifier was read as an
  // expression, which no statement could follow on its line.
  const use = 'function f() { const a = new P(); const b = a; b.x = 5; return String(a.x); } if (f() !== expected) throw new Error(f());';
  expect(await observeModuleGraph({ dep: 'export value class P { x: uint8 = 0; }', main: `import { P } from "dep"; const expected = '0'; ${use}` }))
    .toMatchObject({ status: 'fulfilled' });
  expect(await observeModuleGraph({ dep: 'export class P { x: uint8 = 0; }', main: `import { P } from "dep"; const expected = '5'; ${use}` }))
    .toMatchObject({ status: 'fulfilled' });
  expect(await observeModuleGraph({ dep: 'export default value class P { x: uint8 = 0; }', main: `import P from "dep"; const expected = '0'; ${use}` }))
    .toMatchObject({ status: 'fulfilled' });
  expect(await observeModuleGraph({ dep: 'export default value class { x: uint8 = 0; }', main: `import P from "dep"; const expected = '0'; ${use}` }))
    .toMatchObject({ status: 'fulfilled' });
  for (const head of ['sealed', 'abstract', 'dynamic']) {
    expect(await observeModuleGraph({ dep: `export ${head} class P { x: uint8 = 0; }`, main: 'import { P } from "dep"; if (typeof P !== "function") throw new Error("P");' }), head)
      .toMatchObject({ status: 'fulfilled' });
  }
  // A default export is a declaration: it declares its name, and a statement follows it.
  expect(await observeModuleGraph({ dep: 'export default sealed class P { x: uint8 = 0; } if (typeof P !== "function") throw new Error("P");', main: 'import P from "dep"; if (typeof P !== "function") throw new Error("import");' }))
    .toMatchObject({ status: 'fulfilled' });
  // The kind crosses the module boundary with the class: the importer's checking pass refuses the lost store.
  expect(await observeModuleGraph({ dep: 'export value class P { x: uint8 = 0; }', main: 'import { P } from "dep"; function set(p: P) { p.x = 5; } set(new P());' }))
    .toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } });
  // A decorator list before a modifier was a SyntaxError too, in a statement and in an expression.
  expect(evaluated('@packed value class A { a: uint8; b: uint16; } String((type A).byteLength);')).toBe('3');
  expect(evaluated('value class A { a: uint8; b: uint16; } String((type A).byteLength);')).toBe('4');
  expect(evaluated('const A = @packed value class { a: uint8; b: uint16; }; String(typeof A);')).toBe('function');
  expect(observeScript('function d(c, ctx) { return c; } @d sealed class A { a: uint8 = 0; }').errorClass).toBeUndefined();
  // The line rule holds after a decorator as it does without one.
  expect(observeScript('@packed value\nclass A { a: uint8; }')).toMatchObject({ bodyEntered: false, errorClass: 'SyntaxError' });
});

test('a specialization has the kind of its family, and is selected under a value bound', () => {
  // `uint8` did not satisfy the bound `value` where a specialization was matched, so the specialization
  // was declared and never chosen: every application took the primary.
  const general = "v: T; tag(): string { return 'general'; } constructor(v: T) { this.v = v; }";
  const byte = "v: uint8; tag(): string { return 'byte'; } constructor(v: uint8) { this.v = v; }";
  for (const bound of ['value', 'plain']) {
    expect(evaluated(`value class Cell<T: type extends ${bound}> { ${general} } value class Cell<uint8> { ${byte} } new Cell.<uint8>(1).tag() + '/' + new Cell.<uint16>(1).tag();`), bound).toBe('byte/general');
  }
  expect(evaluated(`class Cell<T: type> { ${general} } class Cell<uint8> { ${byte} } new Cell.<uint8>(1).tag() + '/' + new Cell.<string>('s').tag();`)).toBe('byte/general');
  // One family is one kind: `Cell.<uint8>` copies where `Cell.<uint16>` does, or neither does.
  expectThrown(`value class Cell<T: type extends value> { ${general} } class Cell<uint8> { ${byte} }`, 'is a specialization of a value class, so it is one, and is written `value class`');
  expectThrown(`class Cell<T: type> { ${general} } value class Cell<uint8> { ${byte} }`, 'is a specialization of a class that is not a value class, so it is not declared `value`');
  expect(observeScript(`value class Cell<T: type extends value> { ${general} } class Cell<uint8> { ${byte} }`)).toMatchObject(refused);
});

test('what asks for a value type is answered by the declaration', () => {
  // `shared` and a column store take a value type, and took a class held by reference whose fields
  // happened to be laid out: one object, shared by two agents with no synchronization, or split into
  // columns it could not be read back from as itself.
  expect(evaluated('value class P { x: uint8 = 0; } type S = shared P; "ok";')).toBe('ok');
  const notType = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-type-required' } };
  // The head says the kind, so the checking pass answers before the class is evaluated.
  expect(observeScript('class P { x: uint8 = 0; } type S = shared P;')).toMatchObject(notType);
  expect(observeScript('class P { x: uint8 = 0; } function f(p: shared P) { }')).toMatchObject(notType);
  expect(observeScript('class P { x: uint8 = 0; } type S = shared [2].<P>;')).toMatchObject(notType);
  expect(evaluated('value class P { x: uint8 = 0; y: float32 = 0; } const s = new SoA.<P, 4>(); String(s.length) + String((type SoA.<P, 4>).hasLayout);')).toBe('4true');
  // #sec-structure-of-arrays: "_T_ must be a value type class or a primitive", so naming the
  // type is the type error, before the program runs, and not only constructing one.
  expectThrown('class P { x: uint8 = 0; y: float32 = 0; } const s = new SoA.<P, 4>();', 'cannot be split into columns: it is not a value class');
  expect(observeScript('class P { x: uint8 = 0; y: float32 = 0; } let s: SoA.<P, 4>;')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-layout' } });
  expect(evaluated('class P { x: uint8 = 0; y: float32 = 0; } String((type SoA.<P, 4>).hasLayout);')).toBe('false');
});

test('a class that is not a value class has no layout, wherever one is asked for', () => {
  // The fields of a typed class are sized where they are declared, and what that walk found was
  // read by three things that never asked whether the class has a layout. Each answered for a class
  // whose `hasLayout` is *false*.
  const V = 'value class P { x: uint8 = 0; y: uint32 = 0; } ';
  const R = 'class P { x: uint8 = 0; y: uint32 = 0; } ';
  // A field's placement.
  const offset = 'String((type P).hasLayout) + "/" + String(Reflect.getReflection.<Reflect.ClassFieldLayout, P>("y").offset);';
  expect(evaluated(`${V}${offset}`)).toBe('true/4');
  expectThrown(`${R}${offset}`, 'has no layout, so its field "y" has no placement');
  expect(evaluated(`${R}String((type P).hasLayout);`)).toBe('false');
  // A placement `new`, which put an object that has an identity onto a buffer.
  const placed = 'const b = new ArrayBuffer(16); const p = new(b, 0) P(); p.y = 7; String(new Uint32Array(b)[1]);';
  expect(evaluated(`${V}${placed}`)).toBe('7');
  expectThrown(`${R}${placed}`, 'a placement allocation needs a type with a layout');
  // A field decorator's `offset`.
  const grab = 'let ctx; function g(c) { ctx = c; return undefined; } ';
  expect(evaluated(`${grab}value class P { x: uint32 = 0; @g a: uint8 = 3; } String(ctx.offset);`)).toBe('4');
  expect(evaluated(`${grab}class P { x: uint32 = 0; @g a: uint8 = 3; } String(ctx.offset);`)).toBe('undefined');
  // What the walk is still for: a size the fields exceed is reported for either kind.
  expect(observeScript('@size(2) class A { a: uint32; b: uint32; }')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-layout' } });
});

test('the bound is the type named value, which a binding of that name hides', () => {
  // `value` and `plain` are names, not reserved words, so a binding called `value` in scope is what
  // the bound resolves to. The diagnostic says that rather than that the parameter has no bound.
  for (const scope of ['const value = 1; D', 'function f(value: uint8) { D return 1; } f(1);']) {
    const source = scope.replace('D', 'value class Box<T: type extends value> { v: T; constructor(v: T) { this.v = v; } }');
    expect(observeScript(source), scope).toMatchObject(refused);
    expectThrown(source, 'whose bound "value" does not name the type here: a binding of that name in scope hides it');
  }
  // A parameter called `value` beside the class, not around it, hides nothing.
  expect(evaluated('value class Box<T: type extends value> { v: T; constructor(v: T) { this.v = v; } } function f(value: uint8) { return new Box.<uint8>(value).v; } String(f(3));')).toBe('3');
  // A field named `value` is not a binding.
  expect(evaluated('value class Box<T: type extends value> { value: T; constructor(v: T) { this.value = v; } } String(new Box.<uint8>(3).value);')).toBe('3');
});

test('a field declared twice keeps the type it was given', () => {
  // The second declaration has no annotation and is the same field, so the class has no untyped field.
  expect(evaluated('value class C { a: uint8 = 0; a = 1; } function f() { const c = new C(); const d = c; d.a = 5; return String(c.a) + String(d.a); } f();')).toBe('15');
  expect(observeScript('value class C { a: uint8 = 0; b = 1; b = 2; }')).toMatchObject(refused);
});
