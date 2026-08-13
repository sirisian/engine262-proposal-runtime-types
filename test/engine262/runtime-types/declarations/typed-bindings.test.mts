import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-typed-bindings (Typed Bindings),
 * #sec-typed-initializers-semantics (Typed Initializers).
 *
 * A binding's annotation is checked against its initializer and against every
 * later assignment, across declaration forms and across scopes - including
 * the module boundary, where the check happens at compile time.
 */

function run(source: string, runtimeTypes = true) {
  setSurroundingAgent(new Agent(runtimeTypes ? { features: ['runtime-types'] } : {}));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

function expectTypeError(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

test('annotated bindings are checked against their initializers', () => {
  expectTypeError('let x: uint8 = "s";');
  expectTypeError('let x: uint8 = 300;');
  expectOk('let x: uint8 = 5;');
  expectTypeError('var v: string = 5;');
  expectOk('var v: string = "ok";');
});

test('assignments to declared bindings are checked', () => {
  expectTypeError('let a: uint8 = 5; a = "x";');
  expectOk('let a: uint8 = 5; a = 7;');
  expectTypeError('function g(a: uint8) { a = "x"; }');
});

test('typed initializers infer a widened type', () => {
  expectOk('let x := 5; x = 6;');
  expectTypeError('let x := 5; x = "s";');
  expectOk('let s := "a"; s = "b";');
});

test('aliases resolve statically', () => {
  expectTypeError('type T = uint8; let x: T = 300;');
  expectOk('type T = uint8; let x: T = 3;');
  expectTypeError('type S = string; let n: S = 5;');
});

test('return statements are checked against the annotation', () => {
  expectTypeError('function f(): uint8 { return "s"; }');
  expectOk('function f(): uint8 { return 5; }');
  expectTypeError('const f = (): string => { return 5; };');
});

test('unions and unknown types', () => {
  expectOk('let u: uint8 | string = "s"; u = 3;');
  expectTypeError('let u: uint8 | string = true;');
  // A type the checker cannot resolve is unknown, and unknown is any:
  // silence statically, with the annotation evaluated at run time. Here the
  // type is a first-class Type Object bound by an expression.
  expectOk('const Mystery = type uint8 | string; let y: Mystery = "s"; y = 5;');
});

test('unannotated programs stay silent', () => {
  expectOk('let a = 1; a = "s"; function f() { return a; } f();');
});

// -- Scopes, shadowing, and the module boundary --------------------------------

function compileModule(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.compileModule(source, { specifier: 'm' });
}

test('block scopes shadow without leaking', () => {
  // Inner block re-annotates x; the outer binding is unaffected after.
  expectOk('let x: uint8 = 5; { let x: string = "s"; x = "t"; } x = 6;');
  // The inner error is still caught.
  expectTypeError('let x: uint8 = 5; { let y: string = "s"; y = 3; }');
  // A binding from an inner block does not exist outside it: no false type.
  expectOk('{ let z: uint8 = 1; } let z = "anything";');
});

test('call-site arguments are checked against function types', () => {
  expectTypeError('let f: (a: uint8) => void = () => {}; f("s");');
  expectOk('let f: (a: uint8) => void = () => {}; f(5);');
  expectTypeError('let g: (a: string, b: uint8) => void = () => {}; g("ok", "no");');
});

test('member access types flow from object types', () => {
  expectTypeError('let p: { n: uint8 } = { n: (1 := uint8) }; let s: string = p.n;');
  expectOk('let p: { n: uint8 } = { n: (1 := uint8) }; let m: uint8 = p.n;');
});

test('module goal is checked too', () => {
  // A type error in a module makes compilation throw; a well-typed one is normal.
  expect(compileModule('let x: uint8 = "s";')).toMatchObject({ Type: 'throw' });
  expect(compileModule('let x: uint8 = 5;')).toMatchObject({ Type: 'normal' });
});

test('unmodelled remains any: silence', () => {
  expectOk('let f = (x) => x; let n: uint8 = f(5); let s: string = f("s");');
});

// -- Tuple and parameterized defaults (#sec-defaultvalueof) --------------------
//
// "Return a new tuple of the type _t_ whose elements are, for each element ...
// whose [[Rest]] is *false* and in order, its [[Initial]] where that is not
// ~none~ and the default value of its [[Type]] otherwise."

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

test('a tuple binding takes an element-wise default', () => {
  expect(value('let t: [uint8, uint8]; `${t.length}:${t[0]}:${t[1]}`;')).toBe('2:0:0');
  expect(value('let t: [uint8, uint8]; String(t[0] is uint8);')).toBe('true');
  // Mixed element types each take their own zero.
  expect(value('let t: [uint8, string]; `${t[0]}:${JSON.stringify(t[1])}`;')).toBe('0:""');
  // Nested tuples recurse.
  expect(value('let t: [uint8, [uint8, uint8]]; `${t[1].length}:${t[1][0]}`;')).toBe('2:0');
});

test('a declared initial is used where a position has one', () => {
  // The [[Initial]] is the initializer's value as written, so it is converted
  // to the position's type on the way in - this reads 5, typed.
  expect(value('let t: [uint8, uint8 = 5]; `${t[0]}:${t[1]}`;')).toBe('0:5');
  expect(value('let t: [uint8, uint8 = 5]; String(t[1] is uint8);')).toBe('true');
});

test('a rest position contributes nothing to the default', () => {
  expect(value('let t: [uint8, ...uint8]; String(t.length);')).toBe('1');
});

test('a position with no default leaves the tuple without one', () => {
  // `symbol` has no zero, so the whole tuple answers ~none~ - and a declaration
  // of a type with no default is refused rather than left undefined.
  expectTypeError('let t: [uint8, symbol];');
  // The refusal is the tuple's, not the position's: with an initializer the
  // same type is an ordinary declaration.
  expectOk('let t: [uint8, symbol] = [1, Symbol("s")];');
});

test('each position is its own instance', () => {
  // The fixed-extent array case gives the reason: a class default is an object,
  // and a write through one position must not show at another.
  expect(value('class P { a: uint8; } let d: [P, P]; d[0].a = (1 := uint8); String(d[1].a);')).toBe('0');
});

test('a class field of tuple type takes the default', () => {
  // This threw - "undefined is not assignable" - so a value type class holding
  // a tuple field could not be instantiated at all.
  expect(value('class C { t: [uint8, uint8]; } const c = new C(); `${c.t.length}:${c.t[0]}`;')).toBe('2:0');
});

test('a typed property descriptor of tuple type takes the default', () => {
  expect(value('const o = {};'
    + ' Object.defineProperty(o, "t", { type: type [uint8, uint8], writable: true });'
    + ' `${o.t.length}:${o.t[0]}`;')).toBe('2:0');
});

test('a parameterization defaults to its base zero where that is a value of it', () => {
  const meta = 'type M = { m: number };'
    + ' meta M { default = { m: 0 }; subtype(a, b) { return true; } validate(v, c) { return true; } }';
  expect(value(`${meta} type Meter = float64.<{ m: 1 }>; let d: Meter; \`\${d}:\${d is Meter}\`;`)).toBe('0:true');
});

test('a brand has no default, since its base zero is not a value of it', () => {
  // A governing meta type that constrains and defines no `validate` admits no
  // bare value of the base. DefaultValueOf answers "a value of the type _t_ or
  // ~none~", so it must answer ~none~ here rather than the base's zero.
  const brand = 'type M = { m: number }; meta M { default = { m: 0 }; subtype(a, b) { return true; } }';
  expectTypeError(`${brand} type Meter = float64.<{ m: 1 }>; let d: Meter;`);
});

// -- Numeric-family defaults (#sec-defaultvalueof step 2) ----------------------
//
// "If _t_ is a numeric type, return the value of _t_ representing 0", where the
// numeric types are "Each integer, binary floating-point, decimal
// floating-point, rational, complex, and vector type".

test('the decimal families default to a decimal zero', () => {
  expect(value('let d: decimal128; d.toString();')).toBe('0');
  expect(value('let d: decimal64; d.toString();')).toBe('0');
  expect(value('let d: decimal32; d.toString();')).toBe('0');
  // The zero is the SHORTEST cohort member, not `0.00`: a decimal remembers
  // precision, so which member it is is observable.
  expect(value('let d: decimal128; String(d.toString() === "0");')).toBe('true');
  // And it carries its own width rather than a bare decimal's.
  expect(value('let d: decimal64; String(d is decimal64);')).toBe('true');
});

test('a vector defaults to its lane zero in every lane', () => {
  expect(value('let v: float32x4; `${v.x}:${v.y}:${v.z}:${v.w}`;')).toBe('0:0:0:0');
  expect(value('let v: int32x4; String(v.x is int32);')).toBe('true');
  // The same value the constructor's broadcast builds.
  expect(value('let v: float32x4; String(String(v.x) === String(float32x4(0).x));')).toBe('true');
});

test('a bit-vector mask defaults to all false', () => {
  // `boolean8` is a vector of `uint.<1>` with eight lanes, so it needs no
  // separate rule: the lane zero is the integer zero.
  expect(value('let m: boolean8; `${m.any()}:${m.all()}`;')).toBe('false:false');
  expect(value('let m: boolean32x4; String(m.any());')).toBe('false');
});

test('rational defaults to zero', () => {
  // A numeric type that resolves as a LIBRARY type rather than a primitive, so
  // its zero is answered beside the nominals.
  expect(value('let q: rational; q.toString();')).toBe('0');
  expect(value('let q: rational; String(q is rational);')).toBe('true');
});

test('a class field of these types takes the default', () => {
  // This threw - "undefined is not assignable to decimal128" - so a value type
  // class holding a decimal or a vector field could not be instantiated.
  expect(value('class H { d: decimal128; v: float32x4; }'
    + ' const h = new H(); `${h.d.toString()}:${h.v.x}`;')).toBe('0:0');
});

test('a typed property descriptor of decimal type takes the default', () => {
  expect(value('const o = {};'
    + ' Object.defineProperty(o, "d", { type: decimal128, writable: true });'
    + ' o.d.toString();')).toBe('0');
});

test('a type with no default cannot be declared bare', () => {
  // `symbol` is the case that is correctly ~none~: it has values, and no zero
  // among them. float128 is NO LONGER such a case - it has values now, and
  // #sec-defaultvalueof gives every numeric type the value representing 0.
  expectOk('let f: float128;');
  expect(value('let f: float128; f.toString();')).toBe('0');
  expectTypeError('let s: symbol;');
  expectOk('let s: symbol = Symbol("s");');
});

// -- A type with no default cannot be declared bare (#sec-defaultvalueof) ------
//
// "It is a type error to declare a binding or a field with a type _t_ and no
// initializer when DefaultValueOf(_t_) is ~none~." The engine used to hold
// *undefined* instead - a value not of the declared type, so the binding's own
// invariant was broken before anything touched it.

test('a binding whose type has no default is refused', () => {
  expectTypeError('let x: uint8 | string;');
  expectTypeError('let s: symbol;');
  expectTypeError('let n: never;');
  expectTypeError('let f: (x: uint8) => uint8;');
  expectTypeError('let o: { x: uint8 };');
  // `var` is out of scope, and not because the clause exempts it: a `var`
  // declaration does not take its type's DEFAULT either - `var v: uint8;` is
  // undefined where `let v: uint8;` is 0 - so it never reaches the lookup this
  // rule follows. Recorded in KNOWN-DIVERGENCES.md; this pins today's
  // behaviour so the asymmetry is visible rather than assumed.
  expectOk('var v: uint8 | string;');
  expect(value('var v: uint8; String(v);')).toBe('undefined');
});

test('an initializer is what the refusal asks for', () => {
  expectOk('let x: uint8 | string = "given";');
  expectOk('let s: symbol = Symbol("s");');
  expectOk('let o: { x: uint8 } = { x: 1 };');
});

test('a type WITH a default is unaffected', () => {
  // The nullable union and `any` default to null and undefined respectively,
  // which are values of their types rather than the absence of one.
  expectOk('let u: uint8 | null;');
  expectOk('let a: any;');
  expectOk('let d: uint8;');
  expectOk('let arr: [].<uint8>;');
});

test('a class with methods is not read as having undefaultable members', () => {
  // A class record carries its methods and accessors alongside its fields, and
  // their function types have no default. Reading them as fields would refuse
  // this ordinary program, so the rule consults the FIELDS.
  expectOk('class P { a: uint8; m() { return 1; } get g(): uint8 { return 2; } } let p: P;');
  expect(value('class P { a: uint8; m() { return 1; } } let p: P; String(p.a);')).toBe('0');
});

test('a field of a type with no default is refused, at the declaration it names', () => {
  // This threw before too, but from RequireType inside the constructor and
  // saying "undefined is not assignable to symbol" - the symptom rather than
  // the reason.
  expectTypeError('class C { s: symbol; } new C();');
  expectOk('class C { s: symbol = Symbol("x"); } new C();');
});

test('a generic parameter is exempt', () => {
  // Nothing is known about what an application will bind, so the declaration
  // stands; the check belongs at the specialization, which this engine does not
  // reach (see KNOWN-DIVERGENCES.md).
  expectOk('class Box<T> { value: T; }');
  expectOk('class Box<T> { value: T; } const b = new Box.<uint8>();');
});

test('a registered meta default satisfies the rule', () => {
  // A `meta` default supplies a default for a type with no structural one, and
  // it registers when the MetaDeclaration EVALUATES - which is why this rule is
  // applied after that lookup rather than in the checking pass.
  expectOk('type T = uint8 | string; meta T { subtype(a, b) { return true; } default = "d"; } let s: T;');
  expect(value('type T = uint8 | string; meta T { subtype(a, b) { return true; } default = "d"; } let s: T; s;')).toBe('d');
});

test('a function parameter is not a declaration with no initializer', () => {
  // A parameter takes an argument rather than a default, so a parameter of a
  // type with no default is ordinary.
  expectOk('function f(x: symbol) { return typeof x; } f(Symbol("s"));');
  expectOk('const g = (o: { x: uint8 }) => o.x; g({ x: 1 });');
});

// -- The annotation holds at every assignment (#sec-typed-bindings) -----------
//
// "checked against its initializer AND AGAINST EVERY LATER ASSIGNMENT". The
// initializer crossed the boundary and the assignment did not, so an annotated
// binding was enforced when it was created and not when it was written.

test('an assignment converts the way the initializer does', () => {
  // #sec-literal-propagation: the literal takes the type its position requires,
  // and an annotated binding is such a position.
  expect(value('let v: uint8 = 1; v = 2; `${v}:${v is uint8}`;')).toBe('2:true');
  // `var` is NOT covered, and not by oversight: its storage at the top level is
  // a property of the global object rather than an environment binding, so
  // there is nowhere on it to record a declared type. That is the same
  // structural difference KNOWN-DIVERGENCES.md D25 records for its default -
  // the var path never consults its annotation - and this pins the state rather
  // than assuming it.
  expect(value('var v: uint8 = 1; v = 2; String(v is uint8);')).toBe('false');
  // An already-typed value still round-trips rather than being reconverted.
  expect(value('let v: uint8 = 1; v = (3 := uint8); `${v}:${v is uint8}`;')).toBe('3:true');
});

test('an assignment refuses what the annotation forbids', () => {
  // The severe half: an `any` reaches the binding with nothing the checker can
  // see, and the value it carried was STORED - a uint8 binding holding 300,
  // which no other storage kind permits.
  expectTypeError('let v: uint8 = 1; let a: any = 300; v = a;');
  // And an in-range one converts rather than arriving untyped.
  expect(value('let v: uint8 = 1; let a: any = 2; v = a; `${v}:${v is uint8}`;')).toBe('2:true');
});

test('the static refusals stay static', () => {
  // The checker already refused these, and it must go on refusing them rather
  // than deferring to the new store check: no output means it never ran.
  expectTypeError('console.log("never runs"); let v: uint8 = 1; v = "s";');
  expectTypeError('console.log("never runs"); let v: uint8 = 1; v = 300;');
});

test('a write through a ref inherits the binding it aliases', () => {
  // The entry's own repro. The ref was a symptom: it made the corruption
  // visible by checking the referent again on the NEXT call, so the error named
  // the ref rather than the assignment that caused it.
  expect(value('function f(ref x: uint8) { x = 2; } let v: uint8 = 1; f(ref v); `${v}:${v is uint8}`;')).toBe('2:true');
  expectOk('function f(ref x: uint8) { x = 2; } let v: uint8 = 1; f(ref v); f(ref v);');
  // A local alias writes through the same binding.
  expect(value('let v: uint8 = 1; let ref b = v; b = 3; `${v}:${v is uint8}`;')).toBe('3:true');
  // An update reads and writes the referent, and was already correct.
  expect(value('function f(ref x: uint8) { x++; } let v: uint8 = 1; f(ref v); String(v is uint8);')).toBe('true');
});

test('the storage kinds that already worked are unchanged', () => {
  // Each carries its declared type on the object and checked its store, which
  // is what an environment binding now does too.
  expect(value('class P { x: uint8 = (1 := uint8); } const p = new P(); p.x = 3; String(p.x is uint8);')).toBe('true');
  expect(value('type O = { x: uint8 }; let o: O = { x: 1 }; o.x = 3; String(o.x is uint8);')).toBe('true');
  expect(value('let a: [].<uint8> = [1]; a[0] = 3; String(a[0] is uint8);')).toBe('true');
  expectTypeError('let a: any = 300; class P { x: uint8 = (1 := uint8); } const p = new P(); p.x = a;');
});

test('a binding whose type needs no conversion is untouched', () => {
  expect(value('let s: string = "a"; s = "b"; `${s}:${typeof s}`;')).toBe('b:string');
  expect(value('let b: boolean = true; b = false; String(b);')).toBe('false');
});
