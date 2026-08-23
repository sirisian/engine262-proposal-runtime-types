import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-runtimetypeof. "If _value_ is callable and has declared
 * signatures, return the ~function~ Type Record whose [[Signatures]] are those
 * signatures."
 *
 * The operation enumerated class instances, Arrays, and then everything else as
 * an object type, with no callable step - so a function value's runtime type
 * was an object type unrelated to the function type `f is F` already answered
 * true for. Two mechanisms disagreed about one value.
 *
 * The step sits where the Array step does and for the same reason: an operation
 * that RANKS types sees only what this returns, so a callable reporting an
 * object type could not be ranked against a function type.
 */

const F = "type F = (uint8) => string; function f(a: uint8): string { return ''; } ";

test('function runtime type: an annotated function reports its function type', () => {
  expect(evaluated(`${F}String(Reflect.getReflection(Reflect.typeOf(f)).kind);`)).toBe('function');
  // and it is the SAME interned type the program wrote
  expect(evaluated(`${F}String(Reflect.typeOf(f) === F);`)).toBe('true');
  expect(evaluated(`${F}String(Reflect.typeOf(f).family);`)).toBe('function');
  // membership answered this all along; now reflection agrees
  expect(evaluated(`${F}String(f is F);`)).toBe('true');
  // an arrow declares the same way
  expect(evaluated("const k = (a: uint8): string => '';"
    + ' String(Reflect.getReflection(Reflect.typeOf(k)).kind);')).toBe('function');
});

test('function runtime type: an overloaded function reports every arm', () => {
  expect(evaluated('function h(a: uint8) {} function h(a: string) {}'
    + ' String(Reflect.getReflection(Reflect.typeOf(h)).signatures.length);')).toBe('2');
});

test('function runtime type: a function that declares nothing reports one anyway', () => {
  // PLAN-callable-reflection.md phase 2 (OQ1-B). This test used to assert the
  // opposite, on the rationale that reporting all-`any` parameters "would
  // synthesise the signature the unannotated rule refuses".
  //
  // The rationale did not hold. The checker ALREADY performs that inference and
  // prints it: `function g(a) { return 1; }` is reported as `(a: any) => void`
  // when it fails an annotation. So the old behaviour did not decline to INVENT
  // a type, it declined to REPORT one the engine holds - and the cost was that
  // `Reflect.typeOf` answered differently from the checker about the same value,
  // in both directions, which is the thing #sec-runtimetypeof's own paragraph
  // says step 10 exists to prevent.
  expect(evaluated('function g(a) {} String(Reflect.getReflection(Reflect.typeOf(g)).kind);')).toBe('function');
  expect(evaluated('function g() {} String(Reflect.getReflection(Reflect.typeOf(g)).kind);')).toBe('function');
  // the parameter keeps its NAME and is `any`, which is what the checker holds
  expect(evaluated('function h(a, b) {} const s = Reflect.getReflection(Reflect.typeOf(h)).signatures[0];'
    + ' String(s.parameters.length + ":" + s.parameters[0].name + ":" + (s.parameters[0].type === any));')).toBe('2:a:true');
});

test('function runtime type: the two mechanisms now agree, in both directions', () => {
  // The property this change exists to restore. Before it, `f` was a
  // `() => void` to a binding and a `{}` to reflection; `type {}` to reflection
  // and NOT a `{}` to a binding. Asserted in both directions and beside the
  // binding forms, so reflection and the checker cannot drift apart again.
  expect(evaluated('function f() {} String(Reflect.isAssignable(Reflect.typeOf(f), type () => void));')).toBe('true');
  expect(evaluated('function f() {} String(Reflect.isAssignable(Reflect.typeOf(f), type {}));')).toBe('false');
  expect(evaluated('function f() {} let x: () => void = f; String(typeof x);')).toBe('function');
  expectThrown('function f() {} let x: {} = f;');
  expect(evaluated('function f() {} String(Reflect.typeOf(f) === type {});')).toBe('false');
});

test('F129: every unannotated callable no longer shares one type', () => {
  // The consequence a reader hits first, and the one that mentions nothing
  // about functions when it bites: every unannotated callable answered
  // `type {}`, so a Map keyed on `Reflect.typeOf` collapsed them all into one
  // entry and a dispatch over it took the wrong branch.
  expect(evaluated('function f() {} function g(a) {} String(Reflect.typeOf(f) !== Reflect.typeOf(g));')).toBe('true');
  expect(evaluated('function f() {} function g(a, b) {} const m = new Map();'
    + ' m.set(Reflect.typeOf(f), 1); m.set(Reflect.typeOf(g), 2); String(m.size);')).toBe('2');
});

test('function runtime type: every callable shape reports a function type (OQ4-C)', () => {
  // The rule has to be statable, and "the shapes our edit happened to reach" is
  // not one. An arrow, a builtin, a bound function and a Proxy of a function are
  // all callables whose signature the engine may not hold; each still reports a
  // function type.
  expect(evaluated('const a = () => 1; String(Reflect.getReflection(Reflect.typeOf(a)).kind);')).toBe('function');
  expect(evaluated('String(Reflect.getReflection(Reflect.typeOf(Math.max)).kind);')).toBe('function');
  expect(evaluated('function f(a) {} const b = f.bind(null, 1);'
    + ' String(Reflect.getReflection(Reflect.typeOf(b)).kind);')).toBe('function');
  expect(evaluated('function f() {} const p = new Proxy(f, {});'
    + ' String(Reflect.getReflection(Reflect.typeOf(p)).kind);')).toBe('function');
  // a class constructor is callable too, and used to answer `type {}`
  expect(evaluated('class C { x: uint8 = 1; } String(Reflect.getReflection(Reflect.typeOf(C)).kind);')).toBe('function');
});

test('a TYPE OBJECT is callable and is NOT a function - the ordering the change exposed', () => {
  // Found by this change and nearly shipped as a regression. The callable
  // branch runs before `RuntimeTypeOf`, which hoists #sec-runtimetypeof step 10
  // above steps 5-9; that was invisible while the old filter meant the branch
  // almost never fired.
  //
  // A Type Object has [[Call]] - calling it is a conversion, `uint8(v)` - and
  // an ENUM OBJECT is a Type Object. `typeof` already draws this line and says
  // why. Without the same exclusion here, an enum reported a function type and
  // lost the enumerator names that `keyof Reflect.typeOf(C)` reads.
  expect(evaluated('enum C { Zero, One } type K = keyof Reflect.typeOf(C);'
    + ' String(("Zero" is K) && ("One" is K));')).toBe('true');
  expect(evaluated('enum A: any { X = uint8 } String(Reflect.typeOf(uint8) === A);')).toBe('true');
  // and the steps the branch must not preempt still answer
  expect(evaluated('class C {} String(Reflect.getReflection(Reflect.typeOf(new C())).kind);')).toBe('primitive');
  expect(evaluated('String(Reflect.getReflection(Reflect.typeOf([1, 2])).kind);')).toBe('array');
});

test('function runtime type: the cases the step sits between are unaffected', () => {
  // a class instance is still nominal, an Array still an array type, a plain
  // object still an object type - the three arms the callable step neighbours
  expect(evaluated('class C {} String(Reflect.getReflection(Reflect.typeOf(new C())).kind);')).toBe('primitive');
  expect(evaluated('String(Reflect.getReflection(Reflect.typeOf([1, 2])).kind);')).toBe('array');
  expect(evaluated('String(Reflect.getReflection(Reflect.typeOf({ a: 1 })).kind);')).toBe('object');
});

// -- A signature's [[ThisType]] (#sec-this-adoption) ---------------------------
//
// "It is contravariant, as a parameter is, so a signature with a [[ThisType]] is
// usable where one requiring a NARROWER `this` is required and never the
// reverse. A signature with none supplies no `this` rather than accepting any."
//
// The field was already constructible and reflected - the entry that reported it
// absent measured a SOURCE-written type, which has no spelling for it - so what
// this covers is the rule that gives it meaning.

const mkThis = (t: string) => `Reflect.makeType({ kind: "function", signatures: [{ parameters: [], return: { type: uint8 }${t ? `, this: ${t}` : ''} }] })`;

test('a signature carries and reflects its expected this type', () => {
  expect(evaluated(`type S = { x: uint8 }; const F = ${mkThis('S')};`
    + ' Object.keys(Reflect.getReflection(F).signatures[0]).join(",");')).toBe('parameters,return,this');
  // Part of identity: the same signature with and without one are two types.
  expect(evaluated(`type S = { x: uint8 }; String(${mkThis('S')} !== ${mkThis('')});`)).toBe('true');
});

test('the expected this type is contravariant', () => {
  const setup = 'type Narrow = { x: uint8, y: uint8 }; type Wide = { x: uint8 }; ';
  // A body demanding LESS than the position promises is usable; one demanding
  // more is not.
  expect(evaluated(`${setup} String(Reflect.isAssignable(${mkThis('Wide')}, ${mkThis('Narrow')}));`)).toBe('true');
  expect(evaluated(`${setup} String(Reflect.isAssignable(${mkThis('Narrow')}, ${mkThis('Wide')}));`)).toBe('false');
});

test('none is an absence rather than a wildcard', () => {
  const setup = 'type S = { x: uint8 }; ';
  // "usable nowhere a `this` is required at all"
  expect(evaluated(`${setup} String(Reflect.isAssignable(${mkThis('')}, ${mkThis('S')}));`)).toBe('false');
  // And the other half, which is the EXTRACTION case: a signature that has one
  // is usable nowhere a `this` is absent, so taking a method out of its class
  // and putting it where a free function is expected is refused at the boundary
  // that took it rather than failing inside the body.
  expect(evaluated(`${setup} String(Reflect.isAssignable(${mkThis('S')}, ${mkThis('')}));`)).toBe('false');
  // Where NEITHER has one - every ordinary function - nothing changes.
  expect(evaluated(`String(Reflect.isAssignable(${mkThis('')}, ${mkThis('')}));`)).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type (x: uint8) => boolean, type (x: uint8) => boolean));')).toBe('true');
});

// -- A signature's [[Narrows]] (#sec-declared-narrowing) -----------------------
//
// "A Narrowing Record has a [[Target]], a String naming a parameter of the
// signature or "this", and a [[Type]], a Type Record. A signature's [[Narrows]]
// is a List of them, and it says what a call establishes."

const guard = 'Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "v", type: any }],'
  + ' return: { type: boolean }, narrows: [{ target: "v", type: uint8 }] }] })';
const plain = 'Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "v", type: any }],'
  + ' return: { type: boolean } }] })';

test('a signature carries and reflects its declared narrowings', () => {
  expect(evaluated(`const G = ${guard};`
    + ' Object.keys(Reflect.getReflection(G).signatures[0]).join(",");')).toBe('parameters,return,narrows');
  expect(evaluated(`const G = ${guard};`
    + ' const n = Reflect.getReflection(G).signatures[0].narrows;'
    + ' `${n.length}:${n[0].target}`;')).toBe('1:v');
});

test('what a signature establishes is part of what it is', () => {
  // Two signatures that establish different things are different types, so a
  // program selects the behaviour by annotating with the one it wants. The
  // interning compares types with SameType rather than by the order key, so
  // both had to learn the field or the two collapsed into one record.
  expect(evaluated(`String(${guard} !== ${plain});`)).toBe('true');
  expect(evaluated(`String(${guard} === ${guard});`)).toBe('true');
});

test('a narrowing is refused where nothing could consume it', () => {
  // "Where the [[Return]] is any other type, a non-empty [[Narrows]] is a type
  // error: nothing would consume it." Only `boolean` and ~void~ have a reading.
  expect(evaluated('let m = "accepted";'
    + ' try { Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "v", type: any }],'
    + ' return: { type: uint8 }, narrows: [{ target: "v", type: uint8 }] }] }); }'
    + ' catch (e) { m = e.constructor.name; } m;')).toBe('TypeError');
  // A ~void~ return is the other admitted form: "the call establishes its
  // narrowings by returning at all".
  expect(evaluated('const A = Reflect.makeType({ kind: "function", signatures: [{ parameters: [{ name: "v", type: any }],'
    + ' narrows: [{ target: "v", type: uint8 }] }] });'
    + ' String(Reflect.getReflection(A).signatures[0].narrows.length);')).toBe('1');
});
