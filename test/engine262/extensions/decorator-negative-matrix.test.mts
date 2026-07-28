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
  // The factory form is judged on its RESULT, not on the callee.
  expect(rejectionKind('function f(){ return 5; } class A { @f() a: uint8; }')).toBe('TypeError');
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

test('PINNED GAPS: positions that parse, run nothing, and report nothing', () => {
  // Three positions are accepted by the grammar and silently do nothing. Each
  // reads as support and is worse than a SyntaxError, which is why they are
  // pinned here rather than left in the negative matrix's shadow: a test that
  // asserts the CURRENT answer and names the rule it contradicts is what turns
  // a discovery into a known gap (the same treatment stage D's hoisting
  // divergence has).

  // 1. A CONSTRUCTOR takes a decorator and it never fires. The specification
  // is explicit that there is a context for it: "A constructor is a
  // `ClassMethod` whose name is *"constructor"*, and its parameters are that
  // method's, so a construct signature needs no context of its own." The
  // constructor is excluded from NonConstructorElements and so never reaches
  // the evaluation that applies a member's decorators.
  expect(evaluated('let k = "never fired"; function f(c) { k = c.kind; } class A { @f constructor() {} } k;')).toBe('never fired');

  // 2. A PARTIAL CLASS body fires no decorators at all - not a member's, not a
  // sub-target's - because its members go through MethodDefinitionEvaluation
  // directly rather than through ClassElementEvaluation. decorators.md gives
  // no exception for a partial body, and a `partial class` is where a program
  // adds behaviour to a class it does not own, which is exactly where a
  // decorator is most useful.
  expect(evaluated('class A { x: uint8 = 1; } let k = "never fired"; function f(c) { k = c.kind; } partial class A { @f m() {} } k;')).toBe('never fired');
  expect(evaluated('class A { x: uint8 = 1; } let k = "never fired"; function f(c) { k = c.kind; } partial class A { m(@f p: uint8) {} } k;')).toBe('never fired');
  // The merge itself works, so the gap is the decoration and not the partial.
  expect(evaluated('class A { x: uint8 = 1; } partial class A { m() { return "merged"; } } (new A()).m();')).toBe('merged');

  // 3. THE LARGEST OF THE THREE, and it blocks §6.1's third assertion: a
  // decorator whose last parameter is ANNOTATED WITH ITS CONTEXT - the form
  // #sec-decorator-application defines ("A decorator is an ordinary function
  // whose last parameter is annotated with a reflection context") and the form
  // every example in decorators.md is written in - fails when the decorator
  // runs, with a ReferenceError naming the context. Only an UNTYPED parameter
  // works, which is why every positive decorator test in this suite is written
  // that way.
  //
  // So overload resolution BY CONTEXT TYPE, which is what selects among `@f`
  // declarations and what §6.1 assertion 3 exists to verify, cannot be
  // exercised at all today. The reflection contexts resolve as VALUES and as
  // TYPE ARGUMENTS; what fails is a context in type-annotation position.
  expect(evaluated('try { eval("let x: Reflect.Class = {};"); "NO-THROW"; } catch (e) { e.constructor.name; }')).toBe('ReferenceError');
  expect(evaluated('function f(c: Reflect.ClassField) {} try { eval("class A { @f a: uint8; }"); "NO-THROW"; } catch (e) { e.constructor.name; }')).toBe('ReferenceError');
  // The two forms that DO work, so the gap is located rather than described:
  // the context as a value, and the context as a type ARGUMENT.
  expect(evaluated('typeof Reflect.Class;')).toBe('object');
  expect(evaluated('class A { a: uint8; } typeof Reflect.getReflection.<Reflect.ClassField, A>("a");')).toBe('object');
});

test('a decoration is refused with the feature off', () => {
  // The `@` grammar belongs to runtime-types (cycle 94). With the feature off
  // there is no decorator syntax at all, which is what keeps this proposal's
  // decorators from being mistaken for the TC39 ones: the two share the
  // spelling and nothing else.
  expect(evaluatedFlagOff('try { eval("class A { @f a; }"); "NO-THROW"; } catch (e) { e.constructor.name; }')).toBe('SyntaxError');
});
