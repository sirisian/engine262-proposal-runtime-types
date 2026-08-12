import { test, expect } from 'vitest';
import { evaluated, evaluatedFlagOff } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * The NEGATIVE matrix: "A decoration in a position
 * that admits no decorator, and a context used on the wrong kind of
 * declaration, must be errors. This is the half that keeps the grammar
 * honest."
 *
 * Stages A-G opened roughly thirty-five positions, and every test written for
 * them asserts that a decoration WORKS. A suite of only positive tests passes
 * against an implementation that accepts a decoration anywhere, which is the
 * failure this file exists to catch: the grammar's job is as much refusing the
 * positions the design does not give as admitting the ones it does.
 *
 * Every assertion here was MEASURED before it was written. Where the answer
 * differed from what the plan predicted it is recorded as such rather than
 * quietly asserted, and the three positions that are accepted and do NOTHING
 * are pinned at the end as gaps rather than left to be discovered.
 */

/**
 * The kind a decoration in an illegal position is rejected with.
 *
 * `eval` defers the parse to run time, which is what makes a SyntaxError
 * CATCHABLE and so lets the kind be asserted: the harness's `expectThrownKind`
 * cannot reach an early error, because the script carrying its try/catch never
 * runs, and `expectError` would only say that something failed. The kind is
 * worth having here - a position refused by the GRAMMAR and one refused by a
 * type judgment are different facts, and this file asserts which is which.
 */
function rejectionKind(source: string): string {
  return evaluated(`try { eval(${JSON.stringify(source)}); "NO-THROW"; } catch (e) { e.constructor.name; }`);
}

test('positions that admit no decorator are SYNTAX errors', () => {
  // A type declaration, and with the stronger of
  // the two answers it considered - the grammar admits no decorator there at
  // all, so the question of whether it should be a type error does not arise.
  // "A position that cannot be written cannot be written wrongly."
  expect(rejectionKind('function f(c){} @f type X = uint8;')).toBe('SyntaxError');
  // An interface is a declaration too, and takes none either.
  expect(rejectionKind('function f(c){} @f interface I { a: uint8; }')).toBe('SyntaxError');
  // `var` is not in the Binding family: decorators.md gives `Reflect.Let` and
  // `Reflect.Const` and no `Reflect.Var`, and a var binding is hoisted and
  // function-scoped, so there is no single point at which its declaration is
  // evaluated for a decorator to run at.
  expect(rejectionKind('function f(c){} @f var v = 1;')).toBe('SyntaxError');
  // Statements are not declarations. A decorator runs when the declaration it
  // decorates is evaluated, and these declare nothing.
  //
  // The rule is about the decoration's KIND rather than the position, which is
  // decoratorreplacement.md 7.7's "two tables, not one": syntax replacement is
  // constrained by GRAMMAR and value replacement by TYPE. A REPLACEMENT
  // decorator MAY rewrite a statement - see the tests below - so what is refused
  // here is a RUNTIME decoration of one, which is what `f` is.
  expect(rejectionKind('function f(c){} @f return 1;')).toBe('SyntaxError');
  expect(rejectionKind('function f(c){} @f 1 + 1;')).toBe('SyntaxError');
  expect(rejectionKind('function f(c){} @f import x from "y";')).toBe('SyntaxError');
  // A static block is not in the context table.
  expect(rejectionKind('function f(c){} class A { @f static { } }')).toBe('SyntaxError');
  // A decorator list with nothing to decorate.
  expect(rejectionKind('function f(c){} @f;')).toBe('SyntaxError');
});

test('the block family admits the BLOCK and not the statement', () => {
  // The distinction is easy to lose and worth pinning from both sides, because
  // The block's two entry points come with a grammar that admits
  // `@f if` would look, from a passing positive test, exactly like one that
  // admits `if (c) @f { }`.
  expect(rejectionKind('function f(c){} @f if (true) { }')).toBe('SyntaxError');
  expect(rejectionKind('function f(c){} @f while (false) { }')).toBe('SyntaxError');
  expect(rejectionKind('function f(c){} @f for (;;) { break; }')).toBe('SyntaxError');
  // And the legal spelling of each, for contrast: the decorator goes on the
  // BLOCK, which is what `Reflect.IfBlock` and its siblings name.
  expect(evaluated('let n = 0; function f(c){ n += 1; } if (true) @f { let a = 1; } String(n);')).toBe('1');
});

test('what the decoration RESOLVES TO is judged, and by kind', () => {
  // An undeclared name is an ordinary ReferenceError: a decorator is an
  // ordinary function reached through an ordinary binding, so nothing about
  // the position changes what an unresolvable name does.
  expect(rejectionKind('class A { @nope a: uint8; }')).toBe('ReferenceError');
  // A binding that resolves to a non-function is a TypeError, and this one is
  // the assertion that keeps the reserved-name path honest below: an
  // unrecognized `@name` must reach the binding rather than being treated as
  // a control the implementation does not know.
  expect(rejectionKind('const f = "s"; class A { @f a: uint8; }')).toBe('TypeError');
  expect(rejectionKind('const f = 5; class A { @f a: uint8; }')).toBe('TypeError');
  // `@f()` is judged on the CALLEE, like `@f`: the two are one form, and since
  // there is no factory whose result could be judged instead. What a
  // decorator RETURNS is inspected only on the replacement path.
  expect(rejectionKind('const f = 5; class A { @f() a: uint8; }')).toBe('TypeError');
  expect(rejectionKind('function f(c) { return 5; } class A { @f() a: uint8; }')).toBe('NO-THROW');
});

test('a reserved layout control is not shadowable by a user binding', () => {
  // The reserved names: `@packed` and its siblings are
  // recognized syntactically and never evaluated; a user decorator
  // named `packed` must still be refused, and that interaction is easy to
  // break while opening the door."
  //
  // MEASURED, and the answer is a shade different from the plan's wording: a
  // user binding named `packed` is not REFUSED, it is IGNORED - the control is
  // recognized syntactically, so the name never reaches the binding at all.
  // That is the right behaviour and the stronger one to pin, because it is
  // what makes a layout control mean the same thing in every program: a
  // library that happens to export a function called `packed` cannot change
  // what `@packed` does to a class in a module that imports it.
  const control = '@packed class A { a: uint8; b: uint16; } String((type A).byteLength);';
  expect(evaluated(control)).toBe('3');
  // The same source with the name bound to a function: the layout is still
  // packed, and the function does NOT run.
  expect(evaluated(`let fired = "no"; function packed(c) { fired = "yes"; } ${control}`)).toBe('3');
  expect(evaluated('let fired = "no"; function packed(c) { fired = "yes"; } @packed class A { a: uint8; b: uint16; } fired;')).toBe('no');
  // And the control still applies where the binding is a non-function, which
  // would otherwise be the TypeError of the test above.
  expect(evaluated('const packed = 5; @packed class A { a: uint8; b: uint16; } String((type A).byteLength);')).toBe('3');
  // A name that is NOT a reserved control takes the ordinary path, which is
  // what proves the two are actually distinguished rather than every unknown
  // `@name` being swallowed as a control.
  expect(rejectionKind('class A { @notAControl a: uint8; }')).toBe('ReferenceError');
});

test('the two positions that once parsed and did nothing now FIRE', () => {
  // Both were once accepted-and-silent; both are now reachable.
  //
  // 1. A CONSTRUCTOR is "a `ClassMethod` whose name is *\"constructor\"*", and it
  // was the one member a decorator could be written on and never fire - it is
  // filtered out of NonConstructorElements, so it never reached the arm that
  // applies a member's decorators. The whole body is walked now, so it also
  // keeps its DOCUMENT POSITION among the members.
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind + "/" + String(c.name); } class A { @f constructor() {} } k;')).toBe('ClassMethod/constructor');
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind + ":" + String(c.index); } class A { constructor(@f p: uint8) {} } k;')).toBe('ClassMethodParameter:0');
  expect(evaluated('const l = []; function t(n, c) { l.push(n); } '
    + 'class A { @t("a") x: uint8 = 1; @t("ctor") constructor() {} @t("b") y: uint8 = 2; } l.join(",");')).toBe('a,ctor,b');
  // THE CONSTRUCTOR IS IDENTIFIED BY THE FILTER THAT EXCLUDED IT, not by
  // re-deriving the test - re-deriving missed the forms `PropName` normalizes,
  // and a missed constructor was DEFINED as an ordinary method, putting a
  // `constructor` property on the prototype and changing every instance's
  // structural type. Asserted so the shortcut is not taken again.
  expect(evaluated('class A { constructor() { this.v = 5; } } String(new A().v);')).toBe('5');
  expect(evaluated('class A { "constructor"() { this.v = 5; } } String(Object.getOwnPropertyNames(A.prototype).length);')).toBe('1');

  // 2. A PARTIAL CLASS body fires its members' decorators and its sub-targets.
  // Its methods go through MethodDefinitionEvaluation directly and so never
  // reached that arm either; decorators.md gives a partial body no exception,
  // and it is where a program adds behaviour to a class it does not own.
  const base = 'class A { x: uint8 = 1; } ';
  expect(evaluated(`${base} let k = "NO"; function f(c) { k = c.kind + "/" + String(c.name); } partial class A { @f m() {} } k;`)).toBe('ClassMethod/m');
  expect(evaluated(`${base} let k = "NO"; function f(c) { k = c.kind + ":" + String(c.index); } partial class A { m(@f p: uint8) {} } k;`)).toBe('ClassMethodParameter:0');
  expect(evaluated(`${base} let k = "NO"; function f(c) { k = c.kind; } partial class A { @f get v(): uint8 { return 1; } } k;`)).toBe('ClassGetter');
  // The merge itself is undisturbed.
  expect(evaluated(`${base} partial class A { m() { return "merged"; } } (new A()).m();`)).toBe('merged');
});

test('a decoration is refused with the feature off', () => {
  // The `@` grammar belongs to runtime-types. With the feature off
  // there is no decorator syntax at all, which is what keeps this proposal's
  // decorators from being mistaken for the TC39 ones: the two share the
  // spelling and nothing else.
  expect(evaluatedFlagOff('try { eval("class A { @f a; }"); "NO-THROW"; } catch (e) { e.constructor.name; }')).toBe('SyntaxError');
});

// -- The other table: a replacement decorator MAY rewrite a statement -----------
//
// decoratorreplacement.md 7.7 keeps the two axes apart, and sec-syntax-replacement
// says "every decorable position may be syntax-replaced, including the positions
// that do not admit value replacement". A statement produces no value but has
// syntax, so a `#[cfg]`-shaped macro over `@m return 1;` is exactly the case the
// clause has in mind.
//
// The grammar cannot tell the two apart - the kind comes from the preprocessor
// imports - so the parser admits the statement and an early error judges it.
const NL = String.fromCharCode(10);
const MODE_PRE = 'import { m } from "./x.js" with { preprocessor: "true" };' + NL;

function moduleOutcome(source: string): string {
  const macro: { current?: unknown } = {};
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: { HostResolveReplacementDecorator: (n: string) => (n === 'm' ? macro.current : undefined) },
  } as never));
  const realm = new ManagedRealm();
  macro.current = (realm.evaluateScriptSkipDebugger('(function (t) { return t; })') as { Value?: unknown }).Value;
  const compiled = realm.compileModule(source) as { Type: string };
  return compiled.Type === 'normal' ? 'ACCEPTED' : 'REFUSED';
}

test('a replacement decorator may decorate a statement', () => {
  expect(moduleOutcome(`${MODE_PRE}@m if (1) { }`)).toBe('ACCEPTED');
  expect(moduleOutcome(`${MODE_PRE}@m foo();`)).toBe('ACCEPTED');
  expect(moduleOutcome(`${MODE_PRE}@m var v = 1;`)).toBe('ACCEPTED');
  expect(moduleOutcome(`${MODE_PRE}function o() { @m return 1; }`)).toBe('ACCEPTED');
});

test('a runtime decorator may not, in a module as in a script', () => {
  // The same forms, decorated by a name no preprocessor import introduced. The
  // rule has to hold in every parse path - a Module, a Script, and eval, which
  // takes its own - so it is checked in all three and tested through two of them
  // here and through `rejectionKind` (an eval) above.
  expect(moduleOutcome('function f(c) {} @f if (1) { }')).toBe('REFUSED');
  expect(moduleOutcome('function f(c) {} @f foo();')).toBe('REFUSED');
  expect(moduleOutcome('function f(c) {} function o() { @f return 1; }')).toBe('REFUSED');
  // And the declarations it MAY decorate are unaffected.
  expect(moduleOutcome('function f(c) {} @f class C {}')).toBe('ACCEPTED');
  expect(moduleOutcome('function f(c) {} @f function g() {}')).toBe('ACCEPTED');
  expect(moduleOutcome('function f(c) {} @f { let a = 1; }')).toBe('ACCEPTED');
});
