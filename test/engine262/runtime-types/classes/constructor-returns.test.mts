import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * proposal-runtime-types, PLAN-constructor-returns.md phase 3.
 *
 * The RULE and the SIGNATURE it determines. The scope of the rule - which
 * classes it reaches - is pinned separately in
 * `constructor-returns-scope.test.mts`, phase 2.
 *
 * #sec-typed-classes asserts "the class is the type a construction yields" and
 * never states a rule that makes it so. JavaScript makes it false: a
 * constructor that returns an object IS that object, so `new C() instanceof C`
 * is false, a declared field reads `undefined`, and a private-name brand check
 * fails. This file is that sentence turned into something checkable.
 *
 * Refused rather than checked, for a reason the inheritance test below carries:
 * a base class's returning constructor breaks every subclass, and whether the
 * returned object is assignable to a subclass is not knowable at the base.
 */

/** An early error: the program never runs, so the refusal is not catchable. */
const early = (source: string) => expectStaticTypeError(source);

test('the rule: a typed class constructor may not return a value', () => {
  early('class C { x: uint8 = 1; constructor() { return { a: 1 }; } }');
});

test('F122: the declared field must not read `undefined`', () => {
  // The program that started this. Before phase 1 it was ACCEPTED and `c.z`
  // read `undefined` - a declared `uint8` field, absent at run time, with no
  // diagnostic anywhere near the cause.
  early('class C { z: uint8 = 9; constructor() { return { a: 1 }; } } let c: C = new C(); c.z;');
});

test('`return this` and bare `return` survive', () => {
  expect(evaluated('class C { z: uint8 = 7; constructor() { return this; } } String((new C()).z);')).toBe('7');
  expect(evaluated('class C { z: uint8 = 7; constructor() { if (false) { return; } } }'
    + ' String((new C()).z);')).toBe('7');
});

test('`return 42;` is refused too - the primitive exemption is withdrawn', () => {
  // JavaScript discards a primitive returned from a base constructor, so this
  // form is harmless at run time. It is still refused, because admitting it
  // would require answering why an OBJECT operand differs - and that answer is
  // the type reasoning OQ1-E exists to avoid. The rule is structural: `this`,
  // or nothing.
  //
  // An earlier draft of the plan exempted it. That exemption was carried over
  // from the ruled-out direction, where the rule WAS type-based and so had to
  // name the exemption explicitly.
  early('class C { x: uint8 = 1; constructor() { return 42; } }');
  early('class C { x: uint8 = 1; constructor() { return undefined; } }');
});

test('the side-effecting early exit is the pattern this costs', () => {
  // `if (bad) return log('bad');` is a real form and the rule refuses it. The
  // replacement is one line longer and the diagnostic names it, which is the
  // whole reason the message mentions a statement followed by `return;`.
  early('let bad = true; function log(s) { return s; }'
    + ' class C { x: uint8 = 1; constructor() { if (bad) { return log("bad"); } } }');
  // the replacement runs
  expect(evaluated('let bad = true; function log(s) { return s; }'
    + ' class C { x: uint8 = 1; constructor() { if (bad) { log("bad"); return; } } }'
    + ' String((new C()).x);')).toBe('1');
});

test('the diagnostic names the replacement, not just the refusal', () => {
  // A refusal that only refuses leaves the reader to find the static-factory
  // idiom themselves. Asserted on the message because the message is the
  // teaching, and a future edit that shortens it should have to change a test.
  const message = evaluated('let m = "";'
    + ' try { eval("class C { x: uint8 = 1; constructor() { return {}; } }"); }'
    + ' catch (e) { m = e.message; } String(m);');
  expect(message).toContain('yields its class');
  expect(message).toContain('static method');
});

test('the return ANNOTATION position goes with the returns', () => {
  early('class C { x: uint8 = 1; constructor(): C {} }');
  early('class C { x: uint8 = 1; constructor(): void {} }');
  early('type Foo = { a: uint8 }; class C { x: uint8 = 1; constructor(): Foo { return { a: 1 }; } }');
  // and its own message, distinct from the `return` one
  const message = evaluated('let m = "";'
    + ' try { eval("class C { x: uint8 = 1; constructor(): C {} }"); }'
    + ' catch (e) { m = e.message; } String(m);');
  expect(message).toContain('declares no return type');
});

test('the refusal does not over-reach to the neighbouring member forms', () => {
  // A scoped refusal is exactly the kind of rule that catches its neighbours.
  // A method and a getter keep their return annotations; an object literal's
  // method NAMED `constructor` is an ordinary method and keeps its too.
  expect(evaluated('class C { x: uint8 = 1; m(): uint8 { return 1; } } String((new C()).m());')).toBe('1');
  expect(evaluated('class C { x: uint8 = 1; get g(): uint8 { return 2; } } String((new C()).g);')).toBe('2');
  expect(evaluated('const o = { constructor(): uint8 { return 3; } }; String(o.constructor());')).toBe('3');
  // a setter declares no return type of its own accord (#sec-published-return-types),
  // and still works
  expect(evaluated('class C { x: uint8 = 1; set s(v: uint8) { this.x = v; } }'
    + ' const c = new C(); c.s = 5; String(c.x);')).toBe('5');
});

test('the guarantee: `new C() instanceof C` holds, and so does the private brand', () => {
  // The two invariants F122 broke, restored by construction rather than by a
  // check at `new`.
  const shapes = [
    'class C { x: uint8 = 1; }',
    'class C { x: uint8 = 1; constructor() {} }',
    'class C { x: uint8 = 1; constructor(a) { this.x = a; } }',
    'class C { x: uint8 = 1; constructor() { return this; } }',
  ];
  for (const shape of shapes) {
    expect(evaluated(`${shape} String(new C(1) instanceof C);`), shape).toBe('true');
  }
  expect(evaluated('class C { x: uint8 = 1; #p = 1; static has(o) { return #p in o; } }'
    + ' String(C.has(new C()));')).toBe('true');
});

test('only a SYNTACTIC `this` is exempt, even where the operand can only be `this`', () => {
  // `return cond ? this : this` provably evaluates to `this`, and is refused
  // anyway. That is the structural rule's cost, stated rather than discovered:
  // the exemption is on the OPERAND'S FORM, not on what it evaluates to,
  // because reasoning about what it evaluates to is the type reasoning OQ1-E
  // exists to avoid - the same argument that withdrew the `return 42;`
  // exemption. A rule that admitted this one would owe an answer for
  // `return cond ? this : other`, which it cannot give locally.
  //
  // The replacement is the same as everywhere else and costs one line.
  early('class C { x: uint8 = 1; constructor() { return 1 === 1 ? this : this; } }');
  expect(evaluated('class C { x: uint8 = 1; constructor() { if (1 === 1) { return; } } }'
    + ' String((new C()) instanceof C);')).toBe('true');
});

test('enforcement no longer depends on which position the value flows through', () => {
  // F122's three positions. Before phase 1 they disagreed: a `let` with an
  // annotation was ACCEPTED because the checker statically proved the
  // assignment from `new C()`'s declared type and elided its own runtime check,
  // while a typed parameter and a class-expression binding both threw. The
  // premise was false, not the proof.
  //
  // All three now reach the same early error, at the `return`.
  const body = 'class C { z: uint8 = 9; constructor() { return { a: 1 }; } } ';
  early(`${body} let c: C = new C();`);
  early(`${body} function take(c: C) { return c.z; } take(new C());`);
  early('const K = class { z: uint8 = 9; constructor() { return { a: 1 }; } }; let k: K = new K();');
});

test('inheritance: the error is at the BASE, where the offence is', () => {
  // The case that decided OQ1-E. `B` writes no `return`, declares a field and a
  // method, and before phase 1 got an object with neither - `new B()` was
  // `{"z":0,"b":2}`, `instanceof B` was false, and `m` was undefined. Whether
  // A's returned object is assignable to B is not knowable at A, which is why
  // no local check could have caught this and why the answer is a refusal.
  early('class A { a: uint8 = 1; constructor() { return { z: 0 }; } }'
    + ' class B extends A { b: uint8 = 2; m() { return this.a; } }');
  // the error is A's own: A alone is enough to produce it, with no subclass
  early('class A { a: uint8 = 1; constructor() { return { z: 0 }; } }');
});

test('`super()` is unaffected - a base constructor yields a not-yet-`B`', () => {
  // The rule must not reach the ordinary case it resembles. During `super()`
  // the object under construction is legitimately not yet a `B`, and nothing
  // about that is a `return`.
  expect(evaluated('class A { a: uint8 = 1; constructor(v) { this.a = v; } }'
    + ' class B extends A { b: uint8 = 2; constructor() { super(4); } }'
    + ' const x = new B(); String(x.a + ":" + x.b + ":" + (x instanceof B));')).toBe('4:2:true');
});

test('OQ3-C: a class always reflects exactly one constructor signature', () => {
  const sig = (decl: string) => `${decl} const r = Reflect.getReflection.<Reflect.ClassMethod, C>('constructor');`
    + " String(r.signatures.length + ':' + r.signatures[0].parameters.length"
    + " + ':' + (r.signatures[0].return === undefined));";
  // the IMPLICIT constructor of a class that writes none
  expect(evaluated(sig('class C { x: uint8 = 1; }'))).toBe('1:0:true');
  // written, unannotated, no parameters
  expect(evaluated(sig('class C { x: uint8 = 1; constructor() {} }'))).toBe('1:0:true');
  // written, unannotated, with a parameter
  expect(evaluated(sig('class C { x: uint8 = 1; constructor(y) {} }'))).toBe('1:1:true');
  // annotated - unchanged from before phase 1, which the fix must not disturb
  expect(evaluated(sig('class C { x: uint8 = 1; constructor(y: uint8) {} }'))).toBe('1:1:true');
  // an UNTYPED class too: reflection describes what a thing IS, and an untyped
  // class is constructible. Only OQ1's RULE is scoped by OQ2.
  expect(evaluated(sig('class C { constructor() {} }'))).toBe('1:0:true');
});

test('OQ3-C: a derived parameter carries its name and `any`; a declared one its type', () => {
  const p = (decl: string) => `${decl} const s = Reflect.getReflection.<Reflect.ClassMethod, C>('constructor').signatures[0];`
    + " String(s.parameters[0].name + ':' + (s.parameters[0].type === any));";
  expect(evaluated(p('class C { x: uint8 = 1; constructor(y) {} }'))).toBe('y:true');
  expect(evaluated('class C { x: uint8 = 1; constructor(y: uint8) {} }'
    + " const s = Reflect.getReflection.<Reflect.ClassMethod, C>('constructor').signatures[0];"
    + " String(s.parameters[0].name + ':' + (s.parameters[0].type === uint8));")).toBe('y:true');
});

test('OQ3-C: no constructor signature carries a `return` slot', () => {
  // #sec-published-return-types: "a constructor has none to infer", and after
  // phase 1 none can be written either. Asserted across every shape above so a
  // later change that starts synthesising one has to fail here.
  for (const decl of [
    'class C { x: uint8 = 1; }',
    'class C { x: uint8 = 1; constructor() {} }',
    'class C { x: uint8 = 1; constructor(y) {} }',
    'class C { x: uint8 = 1; constructor(y: uint8) {} }',
    'class C { constructor() {} }',
  ]) {
    expect(evaluated(`${decl} const r = Reflect.getReflection.<Reflect.ClassMethod, C>('constructor');`
      + ' String(r.signatures[0].return === undefined);'), decl).toBe('true');
  }
});

test('F127 closed: an unannotated callable reports `kind: "function"`', () => {
  // This was an ANCHOR - written failing-by-design, asserting `'object'` with
  // F127 named, so that landing the fix would break it and whoever landed it
  // would read the note. That worked: PLAN-callable-reflection.md phase 2
  // landed and this is the rewrite.
  //
  // What it protected: `f` is callable and its reflection said it was a record,
  // with the same node shape `type { a: uint8 }` produces. A kit walker did not
  // fail on it, it succeeded WRONGLY - `mapProperties` took the properties
  // branch and returned a record type built out of a function.
  expect(evaluated('function f() { return 1; }'
    + ' String(Reflect.getReflection(Reflect.typeOf(f)).kind);')).toBe('function');
  expect(evaluated('function g(x: uint8) {}'
    + ' String(Reflect.getReflection(Reflect.typeOf(g)).kind);')).toBe('function');
  // the two no longer differ, which was the whole disagreement
  expect(evaluated('function f() {} function g(x: uint8) {}'
    + ' String(Reflect.getReflection(Reflect.typeOf(f)).kind'
    + ' === Reflect.getReflection(Reflect.typeOf(g)).kind);')).toBe('true');
});

test('a class whose constructor returns is refused before it can be constructed', () => {
  // Belt and braces on the phase ordering: the refusal is an EARLY error, so no
  // amount of never reaching the `new` makes the program legal.
  expectThrown('eval("class C { x: uint8 = 1; constructor() { return {}; } }");');
});
