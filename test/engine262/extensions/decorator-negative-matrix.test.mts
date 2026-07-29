import { test, expect } from 'vitest';
import { evaluated, evaluatedFlagOff } from '../readme/harness.mts';

/**
 * PLAN-decorators.md §6.3, the NEGATIVE matrix: "A decoration in a position
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
  // A type declaration: §7.3 of the plan settled this, and with the stronger of
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
  // stage F added the block's two entry points and a grammar that admitted
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
  // cycle 130 there is no factory whose result could be judged instead. What a
  // decorator RETURNS is not inspected at all yet - replacement is stage H.
  expect(rejectionKind('const f = 5; class A { @f() a: uint8; }')).toBe('TypeError');
  expect(rejectionKind('function f(c) { return 5; } class A { @f() a: uint8; }')).toBe('NO-THROW');
});

test('a reserved layout control is not shadowable by a user binding', () => {
  // §6.3: "Include the reserved names. `@packed` and its siblings are
  // recognized syntactically and never evaluated (cycle 94); a user decorator
  // named `packed` must still be refused, and that interaction is easy to
  // break while opening the door in stage A."
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
  // Both were pinned here as accepted-and-silent. Phase two of
  // PLAN-decorators-remaining.md closed them.
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
  // The `@` grammar belongs to runtime-types (cycle 94). With the feature off
  // there is no decorator syntax at all, which is what keeps this proposal's
  // decorators from being mistaken for the TC39 ones: the two share the
  // spelling and nothing else.
  expect(evaluatedFlagOff('try { eval("class A { @f a; }"); "NO-THROW"; } catch (e) { e.constructor.name; }')).toBe('SyntaxError');
});
