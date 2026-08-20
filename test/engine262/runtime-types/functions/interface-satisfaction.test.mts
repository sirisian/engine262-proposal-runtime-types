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

test.fails('a class satisfies an interface it did not declare', () => {
  // Test A. Asserted by `signature-records`, refused by the implementation, and
  // the refusal conforms to #sec-issubtype. Recorded here as the ONE case that
  // failing test is about, so the decision it needs is visible: either the test
  // is stale (the arm removed exactly this behaviour, deliberately) or the
  // subtype rule should be relaxed - which is a spec change, not a fix.
  expectOk(`${SMALL}${RICH}let s: Small = new Rich();`);
});

test('an interface-typed overload resolves against a disjoint one', () => {
  // The guard for the ranking change: an interface competing with a type it
  // shares no values with must keep resolving as it does now.
  const OV = 'interface I { a: uint8 } function f(x: I): string { return "i"; } '
    + 'function f(x: string): string { return "s"; } ';
  expect(value(`${OV}f({ a: (1 := uint8) });`)).toBe('i');
  expect(value(`${OV}f("q");`)).toBe('s');
});

test.fails('an exact structural match outranks an interface that also accepts', () => {
  // Test B. Both signatures are viable and #table-argument-match-ranks has no
  // rank that separates "matched a structural target exactly" from "satisfied a
  // nominal contract structurally", so the pair is ambiguous. The table wants a
  // rank between exact and literal-taking; C# and Java both answer this question
  // the way the assertion expects.
  const OV = 'interface I { a: uint8 } type O = { a: uint8 }; '
    + 'function f(x: I): string { return "iface"; } function f(x: O): string { return "exact"; } ';
  expect(value(`${OV}f({ a: (1 := uint8) });`)).toBe('exact');
});

test.fails('the ranking does not depend on declaration order', () => {
  // The same pair written the other way round. Recorded beside the case above
  // because a fix that reads the first viable signature would pass one and fail
  // the other, and the difference is invisible in a single test.
  const OV = 'interface I { a: uint8 } type O = { a: uint8 }; '
    + 'function f(x: O): string { return "exact"; } function f(x: I): string { return "iface"; } ';
  expect(value(`${OV}f({ a: (1 := uint8) });`)).toBe('exact');
});

test('two interfaces of one shape stay ambiguous', () => {
  // Neither is an exact match, so a rank that orders interface below exact must
  // not accidentally order these - they remain a declaration the program should
  // not have written.
  expectThrows('interface A1 { a: uint8 } interface B1 { a: uint8 } '
    + 'function f(x: A1): string { return "a"; } function f(x: B1): string { return "b"; } '
    + 'f({ a: (1 := uint8) });');
});
