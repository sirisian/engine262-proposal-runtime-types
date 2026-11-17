import { test, expect } from 'vitest';
import {
  evaluated, expectThrown, observeScript,
} from '../harness.mts';

/**
 * A field its constructor assigns (#sec-typed-classes).
 *
 * "An instance field with no initializer whose type has NO default - a reference class, an object or a
 * function type, an interface, a refinement its base's zero fails - is UNINITIALIZED when its definition
 * is evaluated, and the constructor of the class that declares it assigns it." The first store
 * initializes it; until then it is not a property and a read of it throws; the declaring constructor
 * returning without it throws; and it is an early error only where no constructor can reach it.
 *
 * It was a type error at the declaration: "a declaration of it needs an initializer". So a class could
 * keep nothing its constructor was given unless that thing had a zero, and the design repository's own
 * `class Err<T, E> { error: E; constructor(error: E) { this.error = error; } }` did not run at a
 * reference type.
 */

const R = 'class Conn { id: uint8 = 1; } ';
const missing = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-missing-default' } };

test('a constructor assigns a field whose type has no default', () => {
  expect(evaluated(`${R}class Session { conn: Conn; constructor(c: Conn) { this.conn = c; } } String(new Session(new Conn()).conn.id);`)).toBe('1');
  // An object, a function, an interface, and a refinement whose base's zero fails it.
  expect(evaluated('class H { o: object; constructor(o: object) { this.o = o; } } typeof new H({}).o;')).toBe('object');
  expect(evaluated('class H { f: () => uint8; constructor(f: () => uint8) { this.f = f; } } String(new H(() => 3).f());')).toBe('3');
  expect(evaluated("interface Named { name: string; } class H { n: Named; constructor(n: Named) { this.n = n; } } new H({ name: 'a' }).n.name;")).toBe('a');
  expect(evaluated('type Big = uint8 where this > 5; value class H { b: Big; constructor(b: Big) { this.b = b; } } String(new H(9).b);')).toBe('9');
  // Several fields, a `readonly` one, and a private one.
  expect(evaluated(`${R}class S { readonly conn: Conn; #peer: Conn; n: uint8; constructor(a: Conn, b: Conn) { this.conn = a; this.#peer = b; } get peer(): uint8 { return this.#peer.id; } } const s = new S(new Conn(), new Conn()); String(s.conn.id) + String(s.peer) + String(s.n);`))
    .toBe('110');
  // A generic field takes whatever its application binds.
  expect(evaluated(`${R}class Box<T: type> { value: T; constructor(v: T) { this.value = v; } } String(new Box.<Conn>(new Conn()).value.id) + String(new Box.<uint8>(7).value);`)).toBe('17');
  // A subclass declares and assigns its own.
  expect(evaluated(`${R}class Base { n: uint8; } class Sub extends Base { conn: Conn; constructor(c: Conn) { super(); this.conn = c; } } String(new Sub(new Conn()).conn.id);`)).toBe('1');
});

test('the instance is whole when its constructor returns: sealed, typed, with every field a property', () => {
  expect(evaluated(`${R}class Session { conn: Conn; n: uint8; constructor(c: Conn) { this.conn = c; } } const s = new Session(new Conn()); Object.keys(s).join() + String(Object.isExtensible(s));`))
    .toBe('n,connfalse');
  // The store that initializes the field is checked as every store to it is, and so is a later one.
  expectThrown(`${R}class Session { conn: Conn; constructor(c: any) { this.conn = c; } } new Session({});`, 'is not assignable to');
  expectThrown(`${R}class Session { conn: Conn; constructor(c: Conn) { this.conn = c; } } const u: any = new Session(new Conn()); u.conn = {};`, 'is not assignable to');
  // A `readonly` field cannot be assigned again from outside.
  expectThrown(`${R}class Session { readonly conn: Conn; constructor(c: Conn) { this.conn = c; } } const u: any = new Session(new Conn()); u.conn = new Conn();`);
});

test('a read before the constructor assigns it throws', () => {
  // By a statement placed before the assignment.
  expectThrown(`${R}class Session { conn: Conn; constructor(c: Conn) { const u: any = this; const early = u.conn; this.conn = c; } } new Session(new Conn());`,
    'is read before its constructor has assigned it');
  // By a method the constructor calls, and by a function the instance was handed to.
  expectThrown(`${R}class Session { conn: Conn; constructor(c: Conn) { this.describe(); this.conn = c; } describe(): uint8 { return this.conn.id; } } new Session(new Conn());`,
    'is read before its constructor has assigned it');
  expectThrown(`${R}function peek(s: any): any { return s.conn; } class Session { conn: Conn; constructor(c: Conn) { peek(this); this.conn = c; } } new Session(new Conn());`,
    'is read before its constructor has assigned it');
  expectThrown(`${R}class Session { #conn: Conn; constructor(c: Conn) { this.show(); this.#conn = c; } show(): uint8 { return this.#conn.id; } } new Session(new Conn());`,
    'is read before its constructor has assigned it');
  // It is not yet a property: nothing lists it, and nothing reads *undefined* out of it.
  expect(evaluated(`${R}let seen = ''; class Session { n: uint8; conn: Conn; constructor(c: Conn) { seen = Object.keys(this).join() + String('conn' in this); this.conn = c; seen += '|' + Object.keys(this).join(); } } new Session(new Conn()); seen;`))
    .toBe('nfalse|n,conn');
});

test('a constructor that returns without it throws', () => {
  expectThrown(`${R}class Late { conn: Conn; constructor(c: Conn | null) { if (c) { this.conn = c; } } } new Late(null);`, 'the constructor returned without assigning "conn"');
  expect(evaluated(`${R}class Late { conn: Conn; constructor(c: Conn | null) { if (c) { this.conn = c; } } } String(new Late(new Conn()).conn.id);`)).toBe('1');
  expectThrown(`${R}class S { #conn: Conn; constructor(c: Conn | null) { if (c) { this.#conn = c; } } } new S(null);`, 'the constructor returned without assigning "#conn"');
  // Each class answers for the fields it declares: a subclass's constructor is too late.
  expectThrown(`${R}class Base { conn: Conn; constructor() { const self = this; } } class Sub extends Base { constructor(c: Conn) { super(); this.conn = c; } } new Sub(new Conn());`,
    'the constructor returned without assigning "conn"');
  // A constructor that throws has returned nothing.
  expect(evaluated(`${R}class S { conn: Conn; constructor() { const self = this; throw new RangeError('no'); } } let r = ''; try { new S(); } catch (e) { r = e.name; } r;`)).toBe('RangeError');
});

test('it is an early error only where no constructor can reach the field', () => {
  // No constructor, and a constructor that never mentions `this`.
  expect(observeScript(`${R}class Never { conn: Conn; } new Never();`)).toMatchObject(missing);
  expect(observeScript(`${R}class Never { conn: Conn; constructor(c: Conn) { const d = c; } } new Never(new Conn());`)).toMatchObject(missing);
  // A static field has no constructor, and a binding is not a field.
  expect(observeScript(`${R}class S { static conn: Conn; }`)).toMatchObject(missing);
  expect(observeScript(`${R}let c: Conn;`)).toMatchObject(missing);
  // A constructor that mentions `this` is the run time's to judge, whichever path it takes.
  expect(observeScript(`${R}class Late { conn: Conn; constructor(c: Conn | null) { if (c) { this.conn = c; } } } new Late(new Conn());`)).toMatchObject({ bodyEntered: true });
  expect(observeScript(`${R}class Init { conn: Conn; constructor(c: Conn) { this.init(c); } init(c: Conn) { this.conn = c; } } new Init(new Conn());`)).toMatchObject({ bodyEntered: true });
});

test('a class with such a field has no default, and one whose fields all have defaults is as before', () => {
  expect(observeScript(`${R}class Session { conn: Conn; constructor(c: Conn) { this.conn = c; } } let s: Session;`)).toMatchObject(missing);
  expect(evaluated('value class P { x: uint8; s: string; constructor() { } } const p = new P(); String(p.x) + "[" + p.s + "]";')).toBe('0[]');
  expect(evaluated('value class P { x: uint8; constructor(x: uint8) { this.x = x; } } let d: P; String(d.x) + String(new P(4).x);')).toBe('04');
});

test("the design repository's result class holds an error", () => {
  const SRC = "class PE extends Error { status: uint16; constructor(m: string, s: uint16) { super(m); this.status = s; } } "
    + 'class Err<E: type> { error: E; constructor(error: E) { this.error = error; } } ';
  expect(evaluated(`${SRC}const e = new Err.<PE>(new PE('not found', 404)); e.error.message + String(e.error.status);`)).toBe('not found404');
  expect(evaluated(`${SRC}class RateLimited extends Error { cause2: PE; constructor(c: PE) { super('rate limited'); this.cause2 = c; } } const r = new RateLimited(new PE('x', 429)); r.message + String(r.cause2.status);`))
    .toBe('rate limited429');
});
