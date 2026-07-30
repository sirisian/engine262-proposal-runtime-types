import { test, expect } from 'vitest';
import { evaluated, expectThrown, evaluatedFlagOff } from '../readme/harness.mts';

/**
 * PLAN-rest-parameters.md phase 4: calls.
 *
 * Where the feature becomes real. Phase 1 made the forms parse and phase 2 gave
 * the matcher; this binds a call through it, on both sides:
 *
 * - the CHECKER, where viability was an arity count that assumed one trailing
 *   rest (#sec-resolveoverload), and
 * - the RUN TIME, where FunctionDeclarationInstantiation walks the argument
 *   iterator binding each parameter in turn, so a rest that is not last took a
 *   single argument like any other parameter (#sec-bindarguments).
 *
 * The runtime assignment runs over RUN-TIME types rather than the checker's
 * static ones, which is what a call arriving through `apply` or a spread of
 * unknown length needs; for a call the checker has accepted, the two agree.
 *
 * The design's three worked examples are the acceptance tests: they are what
 * the README prints, and an engine that does not reproduce them is wrong
 * whatever else it does.
 */

test('the README\'s worked binding, exactly', () => {
  // `f(...a, ...b, c)` called `f(0, 1, 2)` binds a to [0, 1], b to [], c to 2.
  // The first rest takes all three, the tail cannot be satisfied, it gives one
  // back, the second rest takes the remaining one and `c` cannot be satisfied,
  // it gives that back too, and the assignment settles.
  expect(evaluated(`
    function f(...a: [].<number>, ...b: [].<number>, c: number) {
      return a.length + "," + b.length + "," + c;
    }
    f(0, 1, 2);
  `)).toBe('2,0,2');
});

test('the types decide where one run ends and the next begins', () => {
  // `f(a: string, ...args, ...args2, callback)` with ('a', 0, 1, 2, 'a', 'b', fn).
  expect(evaluated(`
    function f(a: string, ...x: [].<number>, ...y: [].<string>, cb: () => void) {
      return x.length + "," + y.length;
    }
    f("a", 0, 1, 2, "a", "b", () => {});
  `)).toBe('3,2');
});

test('untyped rests are bounded by the typed parameters around them', () => {
  // The design once explained this with a rule that "dynamic types have less
  // precedence than typed parameters". No such rule exists: an untyped rest
  // admits everything, and a longer first run simply leaves no function for the
  // last parameter.
  expect(evaluated(`
    function f(...a1, cb1: () => void, ...a2, cb2: () => void) {
      return a1.length + "," + a2.length;
    }
    f("a", 1, 1.0, () => {}, "b", 2, 2.0, () => {});
  `)).toBe('3,3');
});

test('a rest gives back what the parameters after it require', () => {
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return a.length + ":" + b; }
    f(1, 2, "x");
  `)).toBe('2:x');

  // A rest that receives nothing is an empty array, not undefined.
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return a.length + ":" + b; }
    f("x");
  `)).toBe('0:x');
});

test('a call no assignment satisfies is refused', () => {
  expectThrown('function f(...a: [].<number>, b: string) { return 1; } f("x", "y");');
});

test('the trailing-rest path is untouched', () => {
  // Every signature written before this feature takes the streaming walk and
  // never reaches the assignment. This is the hottest path in the engine and
  // the one place a mistake MISBINDS a program rather than rejecting it.
  expect(evaluated('function f(a: string, ...r: [].<number>) { return a + r.length; } f("a", 1, 2);')).toBe('a2');
  expect(evaluated('function f(a, ...r) { return r.length; } String(f(1, 2, 3));')).toBe('2');
  expect(evaluatedFlagOff('function f(a, ...r) { return r.length; } String(f(1, 2, 3));')).toBe('2');
});

test('every call form reaches the same binding', () => {
  const body = 'function f(...a: [].<number>, b: string) { return a.length + ":" + b; }';
  // A dynamically built argument list, which is the case the runtime
  // assignment exists for: the checker cannot see these lengths.
  expect(evaluated(`${body} f.apply(null, [1, 2, "x"]);`)).toBe('2:x');
  expect(evaluated(`${body} const xs = [1, 2, "x"]; f(...xs);`)).toBe('2:x');
  expect(evaluated('class C { m(...a: [].<number>, b: string) { return a.length + ":" + b; } } new C().m(1, 2, "x");')).toBe('2:x');
  expect(evaluated('function* g(...a: [].<number>, b: string) { yield a.length + ":" + b; } g(1, 2, "x").next().value;')).toBe('2:x');
  expect(evaluated('const g = (...a: [].<number>, b: string) => a.length + ":" + b; g(1, 2, "x");')).toBe('2:x');
});

test('arguments still holds every argument', () => {
  // The assignment distributes the arguments among the parameters; it does not
  // consume them. `arguments` is the call's own list and is unaffected.
  expect(evaluated('function f(...a: [].<number>, b: string) { return String(arguments.length); } f(1, 2, "x");')).toBe('3');
});

test('length counts the parameters before the first rest or default', () => {
  // A rest may now lead, and `Function.prototype.length` stops at it wherever
  // it sits rather than only at the last position.
  expect(evaluated('function f(...a: [].<number>, b: string) {} String(f.length);')).toBe('0');
  expect(evaluated('function f(a: number, ...b: [].<number>, c: string) {} String(f.length);')).toBe('1');
  expect(evaluated('function f(a: number, b: number) {} String(f.length);')).toBe('2');
  expect(evaluatedFlagOff('function f(a, ...b) {} String(f.length);')).toBe('1');
});

test('overload resolution admits a signature the assignment satisfies', () => {
  // Viability is now the assignment rather than an arity count, so a rest away
  // from the end no longer makes the parameter count an upper bound.
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return "mid"; }
    f(1, 2, "x");
  `)).toBe('mid');

  // A signature matching on its fixed parameters is still preferred over one
  // matching only by absorbing arguments into a rest.
  expect(evaluated(`
    function f(a: number) { return "fixed"; }
    function f(...a: [].<number>) { return "rest"; }
    f(1);
  `)).toBe('fixed');
  expect(evaluated(`
    function f(a: number) { return "fixed"; }
    function f(...a: [].<number>) { return "rest"; }
    f(1, 2);
  `)).toBe('rest');
});
