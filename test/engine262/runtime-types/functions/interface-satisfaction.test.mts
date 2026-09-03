import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-interfaces-semantics, #sec-issubtype, #table-argument-match-ranks.
 *
 * The baseline for the two standing failures, measured rather than assumed. It
 * pins three things:
 *
 *   - what an interface-typed position accepts TODAY, which is the guard for
 *     any change to either rule;
 *   - the ONE case each failing test is about, marked `test.fails`;
 *   - the distinction the whole area turns on, which is that an interface is
 *     answered nominally as a SUBTYPE question and structurally as a VALUE
 *     question - `sec-interfaces-semantics` says so in one sentence, and a
 *     reader who takes it as one rule concludes the implementation is broken.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

function expectThrows(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}


const SMALL = 'interface Small { m(): uint8; } ';
const RICH = 'class Rich { v: uint8 = 1; m(): uint8 { return (0 := uint8); } } ';

test('an interface is answered STRUCTURALLY as a value question', () => {
  // #sec-interfaces-semantics: "an object that has the members satisfies an
  // interface-typed position whether or not any class declared it", decided by
  // IsOfType - which is the run-time test. A class instance passes it without
  // declaring anything.
  expect(value(`${SMALL}${RICH}\`\${new Rich() is Small}\`;`)).toBe('true');
  expect(value('interface I { a: uint8 } `${({ a: (1 := uint8) }) is I}`;')).toBe('true');
});

test('an interface is answered NOMINALLY as a subtype question', () => {
  // #sec-issubtype relates two ~nominal~ types along declared inheritance only,
  // and an interface's type is ~nominal~ - so a class reaches an interface-typed
  // position by declaring `implements` and not by matching its shape. The arm
  // enforcing this was written deliberately: a class "states a construction and
  // an identity as well as a shape, and it is the identity that its type is
  // for".
  expectThrows(`${SMALL}${RICH}let s: Small = new Rich();`);
  expectOk(`${SMALL}class R2 implements Small { m(): uint8 { return (0 := uint8); } } let s: Small = new R2();`);
  // Inherited from a declaring superclass.
  expectOk(`${SMALL}class A implements Small { m(): uint8 { return (0 := uint8); } } class B extends A {} let s: Small = new B();`);
});

test('a structural source reaches an interface, and an interface reaches a structural target', () => {
  // #sec-issubtype's structural steps run BEFORE the kinds are separated, which
  // is why an object literal satisfies an interface-typed position and why an
  // interface-typed value satisfies a structural alias of the same shape.
  expectOk('interface I { a: uint8 } let v: I = { a: 1 };');
  expectOk('interface I { a: uint8 } function f(x: I) { return "ok"; } f({ a: (1 := uint8) });');
  expectOk(`${SMALL}type O = { m(): uint8 }; let o: O = { m() { return (0 := uint8); } }; let s: Small = o;`);
  expectOk(`${SMALL}let s: Small = { m() { return (0 := uint8); } }; type O = { m(): uint8 }; let o: O = s;`);
});

test('a shape that does not satisfy the interface is refused whatever the rule', () => {
  // The guard for any change to the subtype rule: these must stay refused.
  expectThrows(`${SMALL}class Bad { z: uint8 = 1; } let s: Small = new Bad();`);
  expectThrows(`${SMALL}class Bad { m(): string { return "s"; } } let s: Small = new Bad();`);
});

test('a class that did not declare the interface is refused, and the escapes work', () => {
  // Issue A, adjudicated: the implementation is right and the assertion in
  // `signature-records` was stale. That test's own comment says it is exercising
  // "the ordinary use of `implements`" and its code omitted the clause; adding
  // it makes the test do what it says.
  //
  // The refusal is coherent rather than merely conformant. The checker can see
  // the source is a `Rich` and refuses a claim no declaration made; the value
  // question is separate and answers *true*; and stating the claim takes one
  // token.
  expectThrows(`${SMALL}${RICH}let s: Small = new Rich();`);
  expect(value(`${SMALL}${RICH}\`\${new Rich() is Small}\`;`)).toBe('true');
  expect(value(`${SMALL}${RICH}let s: Small = (new Rich() := Small); \`\${s.m()}\`;`)).toBe('0');
  expectOk(`${SMALL}class R2 implements Small { m(): uint8 { return (0 := uint8); } } let s: Small = new R2();`);
});

test('an interface-typed overload resolves against a disjoint one', () => {
  // The guard for the ranking change: an interface competing with a type it
  // shares no values with must keep resolving as it does now.
  const OV = 'interface I { a: uint8 } function f(x: I): string { return "i"; } '
    + 'function f(x: string): string { return "s"; } ';
  expect(value(`${OV}f({ a: (1 := uint8) });`)).toBe('i');
  expect(value(`${OV}f("q");`)).toBe('s');
});

test('an exact structural match outranks an interface that also accepts', () => {
  // Test B. Both signatures are viable and #table-argument-match-ranks has no
  // rank that separates "matched a structural target exactly" from "satisfied a
  // nominal contract structurally", so the pair is ambiguous. The table wants a
  // rank between exact and literal-taking; C# and Java both answer this question
  // the way the assertion expects.
  const OV = 'interface I { a: uint8 } type O = { a: uint8 }; '
    + 'function f(x: I): string { return "iface"; } function f(x: O): string { return "exact"; } ';
  expect(value(`${OV}f({ a: (1 := uint8) });`)).toBe('exact');
});

test('the ranking does not depend on declaration order', () => {
  // The same pair written the other way round. Recorded beside the case above
  // because a fix that reads the first viable signature would pass one and fail
  // the other, and the difference is invisible in a single test.
  const OV = 'interface I { a: uint8 } type O = { a: uint8 }; '
    + 'function f(x: O): string { return "exact"; } function f(x: I): string { return "iface"; } ';
  expect(value(`${OV}f({ a: (1 := uint8) });`)).toBe('exact');
});

test('one signature written twice is refused where it is written', () => {
  // #sec-overload-resolution: "it is a type error to declare a signature that is
  // viable for the same argument list as an existing one at the same rank". Two
  // aliases of one shape are that case, and so is a literal repetition, and so
  // is an alias of a primitive beside the primitive - the declaration was
  // accepted and every call failed instead, with nothing at the declaration to
  // say why.
  expectThrows('type O1 = { a: uint8 }; type O2 = { a: uint8 }; '
    + 'function g(x: O1): string { return "1"; } function g(x: O2): string { return "2"; }');
  expectThrows('function g(x: uint8): string { return "a"; } function g(x: uint8): string { return "b"; }');
  expectThrows('type U = uint8; function g(x: U): string { return "u"; } function g(x: uint8): string { return "p"; }');
});

test('the duplicate rule does not reach the pairs that are legitimately distinct', () => {
  // Return-type overloading: same parameters, different returns, distinguished
  // by the contextual type of a call (#sec-overloading-on-return-type).
  expectOk('function g(x: uint8): string { return "a"; } function g(x: uint8): uint8 { return (0 := uint8); }');
  // Different arity.
  expectOk('function g(x: uint8): string { return "1"; } function g(x: uint8, y: uint8): string { return "2"; }');
  // An interface and a structurally identical alias are DIFFERENT parameter
  // types, by the same reading the ranking uses - a ~nominal~ type is
  // identified by its declaration. Reading them as one would refuse the pair
  // the rank exists to order.
  expectOk('interface I { a: uint8 } type O = { a: uint8 }; '
    + 'function f(x: I): string { return "i"; } function f(x: O): string { return "o"; }');
  // A parameter type this pass cannot resolve proves nothing, so a pair built
  // from two of them is left alone rather than refused.
  expectOk('function f(c: Reflect.ClassField) { } function f(c: Reflect.ClassAccessor) { }');
});

test('ranking works where the shapes differ', () => {
  // The guard that says the machinery orders overloads and fails on one
  // relation, rather than being absent. Both of these resolve today.
  expect(value('interface I { a: uint8 } type O = { b: uint8 }; '
    + 'function f(x: I): string { return "i"; } function f(x: O): string { return "o"; } '
    + 'f({ a: (1 := uint8) });')).toBe('i');
  expect(value('interface I { a: uint8 } type O = { a: uint8, b: uint8 }; '
    + 'function f(x: I): string { return "i"; } function f(x: O): string { return "o"; } '
    + 'f({ a: (1 := uint8), b: (2 := uint8) });')).toBe('o');
});

test('a generic interface is NOT satisfied by a class that never declared it', () => {
  // The declaration site takes `<T>` and the use site `.<T>`; an earlier probe
  // used the use-site spelling in both places and reported a parse error, which
  // was recorded as an open question. It is not one.
  //
  // INVERTED. This asserted `expectOk` and passed only because a
  // parameterised interface resolved to NULL and nothing was compared - so it
  // recorded the absence of a check rather than a rule. `sec-interfaces` gives
  // two routes and a class instance is in one: "a class that implements it is a
  // subtype of it ... which follows the declared hierarchy. An interface may
  // also type an object, an array, or a function structurally."
  //
  // `sec-object-types` says it from the other side: "Every interface has one [a
  // structural form]. A class has none: a class states a construction and an
  // identity as well as a shape, and it is the identity that its type is for."
  expectThrows('interface Box<T> { get(): T; } class C { get(): uint8 { return (1 := uint8); } } '
    + 'let b: Box.<uint8> = new C();');
  // NOT asserted here: the `implements` route, which should make it a subtype
  // "by the declared hierarchy" and is REFUSED today - `"C" is not assignable to
  // "Box.<uint.<8>>"` with the clause written. That is a separate gap: what is
  // settled here is which routes EXIST, not whether each works.
  //
  // An OBJECT satisfies it structurally, which is the route the list names.
  expectOk('interface Box<T> { get(): T; } let b: Box.<uint8> = { get() { return (1 := uint8); } };');
});

test('two interfaces of one shape stay ambiguous', () => {
  // Neither is an exact match, so a rank that orders interface below exact must
  // not accidentally order these - they remain a declaration the program should
  // not have written.
  expectThrows('interface A1 { a: uint8 } interface B1 { a: uint8 } '
    + 'function f(x: A1): string { return "a"; } function f(x: B1): string { return "b"; } '
    + 'f({ a: (1 := uint8) });');
});

test('all three argument kinds rank the same way', () => {
  // A literal argument, a typed argument, and an `any` argument reach the
  // resolution by different paths, and reported different messages while they
  // were ambiguous - which is why every case is run in all three forms. A fix
  // to one path would have left the other two.
  const OV = 'interface I { a: uint8 } type O = { a: uint8 }; '
    + 'function f(x: I): string { return "iface"; } function f(x: O): string { return "exact"; } ';
  expect(value(`${OV}f({ a: (1 := uint8) });`)).toBe('exact');
  expect(value(`${OV}let v: O = { a: (1 := uint8) }; f(v);`)).toBe('exact');
  expect(value(`${OV}function anyv() { return { a: (1 := uint8) }; } f(anyv());`)).toBe('exact');
});
