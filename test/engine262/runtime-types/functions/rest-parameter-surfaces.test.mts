import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

/**
 * PLAN-rest-parameters.md phase 6.5 to 6.8: the surfaces a rest parameter
 * reaches once it can sit anywhere.
 *
 * The plan asks for these groups because the feature is not one code path: a
 * parameter list is read by the parser, the checker's overload resolution, the
 * runtime binder, the named-argument assembly, the decorator walk, and generic
 * specialization, and a rest away from the end is a new shape for every one of
 * them. Two of them were wrong and are fixed with this file.
 */

test('6.5 a rest-carrying signature competes with a fixed one', () => {
  // #sec-resolveoverload's own example: `f(a: float32)` and
  // `f(...a: [].<float32>)` are ambiguous for a one-argument call, because "a
  // default or a rest parameter expands a signature into a family of arities,
  // and it is the family that must not collide". Declaring both is admitted;
  // the fixed row wins the call it can take.
  expect(ok('function f(a: number): void {} function f(...a: [].<number>): void {}')).toBe(true);
  expect(evaluated(`
    function f(a: number) { return "fixed"; }
    function f(...a: [].<number>) { return "rest"; }
    f(1) + "/" + f(1, 2);
  `)).toBe('fixed/rest');

  // Only the multi-rest signature can bind this list, so it is selected.
  expect(evaluated(`
    function g(a: number) { return "fixed"; }
    function g(...a: [].<number>, b: string) { return "mid"; }
    g(1, 2, "x");
  `)).toBe('mid');
});

test('6.6 a named argument may open a rest', () => {
  // The design's example, README "Rest Parameters" and #sec-named-arguments:
  // `f(8, args: 'a', 'b')` binds a to 8, leaves b its default, and gives args
  // both strings - the positionals following a named rest join that rest.
  expect(evaluated(`
    function f(a: number, b: string = "", ...args: [].<string>) { return a + ":" + args.length; }
    f(8, args: "a", "b");
  `)).toBe('8:2');
});

test('6.6 a named rest still gives back to the parameters after it', () => {
  // The clause's rule alone would hand the rest every positional that follows
  // and leave `c` unfilled. The give-back is the binding's, not the assembly's.
  expect(evaluated(`
    function g(...a: [].<number>, c: number) { return a.length + ":" + c; }
    g(a: 0, 1, 2, 3);
  `)).toBe('3:3');
});

test('6.6 a named argument may name a parameter AFTER a rest', () => {
  // This was dropped. The named-argument assembly stopped at the rest, so the
  // value for `b` never reached the call and it failed as unassignable. Values
  // named for parameters after the rest are appended in parameter order.
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return a.length + ":" + b; }
    f(1, 2, b: "x");
  `)).toBe('2:x');
});

test('6.6 spreads reach the same binding', () => {
  // An object spread binds by parameter name; an iterable spread fills
  // positions, and the assignment distributes them afterwards.
  expect(evaluated('function f(a: number, b: string) { return a + ":" + b; } f(...{ a: 1, b: "x" });')).toBe('1:x');
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return a.length + ":" + b; }
    const xs = [1, 2];
    f(...xs, "x");
  `)).toBe('2:x');
});

test('6.7 an accessor still refuses a rest', () => {
  // A setter takes exactly one parameter, which the base language enforces and
  // this feature does not relax: a rest there would have no argument to take.
  expect(ok('class C { set p(...a: [].<number>) {} }')).toBe(false);
});

test('6.8 a decorator may sit on a rest parameter', () => {
  // decorators.md's dependency-injection example walks a method's parameters,
  // and a rest IS a parameter. The decorators were read inside the non-rest
  // branch of the parameter parser, so `@d ...a` was a Syntax Error while
  // `@d a` was not - a gap older than the rest positions of this feature.
  expect(evaluated(`
    function d(c: Reflect.ClassMethodParameter) {}
    class C { m(@d ...a: [].<number>, @d b: string) { return b; } }
    new C().m(1, "x");
  `)).toBe('x');
});

test('6.8 a generic function may carry a typed rest away from the end', () => {
  // Specialization substitutes into the parameter types, and the runtime
  // assignment reads those annotations. A type it cannot resolve in the frame
  // it runs in - `[].<T>` before substitution - admits rather than throwing,
  // since the assignment distributes and the per-parameter check enforces.
  expect(evaluated(`
    function f<T>(...a: [].<T>, b: string) { return a.length + ":" + b; }
    f.<number>(1, 2, "x");
  `)).toBe('2:x');
  expect(evaluated(`
    function f<T>(...a: [].<T>) { return a.length; }
    String(f.<number>(1, 2));
  `)).toBe('2');
});

test('6.8 a rest-bound array is an ordinary array', () => {
  // Whatever a rest collects is a value like any other: it interns as a
  // composite by its contents, which is the cheapest check that the binding
  // produced a real array rather than something array-shaped.
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return Composite(a) === Composite([1, 2]); }
    String(f(1, 2, "x"));
  `)).toBe('true');
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return Array.isArray(a) + ":" + a.join("-"); }
    f(1, 2, "x");
  `)).toBe('true:1-2');
});

/**
 * What 6.8 asks for and this file does not test: pattern matching over a
 * rest-bound array.
 *
 * `match` is not implemented in this engine - `match (1) { when 1: 1; }` is a
 * Syntax Error - so there is nothing to exercise. The plan wrote the item
 * because the design has the feature; the engine has not reached it. Recorded
 * rather than skipped silently, so that whoever implements pattern matching
 * finds the case waiting.
 */
