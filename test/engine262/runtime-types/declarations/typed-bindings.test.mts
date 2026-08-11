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
  // `symbol` has no zero, so the whole tuple answers ~none~. #sec-defaultvalueof
  // makes such a declaration a type error; the engine leaves the binding
  // undefined instead, which is recorded in KNOWN-DIVERGENCES.md - this pins
  // what it does today rather than what the clause asks for.
  expect(value('let t: [uint8, symbol]; String(t);')).toBe('undefined');
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
  expect(value(`${brand} type Meter = float64.<{ m: 1 }>; let d: Meter; String(d);`)).toBe('undefined');
});
