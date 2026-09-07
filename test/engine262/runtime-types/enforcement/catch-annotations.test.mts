import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

// ---------------------------------------------------------------------------
// A CATCH CLAUSE'S ANNOTATION TYPES ITS PARAMETER.
//
// `try {} catch (e: TypeError) { let s: string = e; }` was accepted: the bound
// name had no Static Type, so nothing in the handler was checked against the
// annotation the program wrote. The same annotation on a `let` is refused. This
// is the third binding form found dropping its annotation, after destructuring
// members and `for`-of bindings.
//
// The annotation is NOT judged for satisfiability: ECMAScript throws any value,
// so `catch (e: uint8)` is reachable and refusing it would be wrong.
// ---------------------------------------------------------------------------

test('the handler body is checked against the catch annotation', () => {
  expectStaticTypeError('try {} catch (e: TypeError) { let s: string = e; }');
  expectStaticTypeError('try {} catch (e: uint8) { let s: string = e; }');
  expectStaticTypeError('try {} catch (e: { a: uint8 }) { let s: string = e; }');
  // A use that fits still works.
  expect(ok('try {} catch (e: TypeError) { let t: TypeError = e; }')).toBe(true);
});

test('each clause is typed, and its binding does not leak to the next', () => {
  expectStaticTypeError('try {} catch (e: RangeError) { } catch (e2: TypeError) { let s: string = e2; }');
  // `a` is bound only in its own clause; `b` in its own. Naming them differently
  // would pass either way, so this asserts the second clause's own binding is
  // the one in view.
  expect(ok('try {} catch (a: RangeError) { } catch (b: TypeError) { let t: TypeError = b; }')).toBe(true);
});

test('what the change does not alter', () => {
  // An unannotated clause binds an untyped name, as before.
  expect(ok('try {} catch (e) { let s: string = e; }')).toBe(true);
  // The `try` block and the `finally` block are still walked. The node carries
  // both a `Catch` and a `CatchClauses` list containing the same clause, so the
  // handler had been walked TWICE - once untyped; skipping the duplicate must
  // not stop anything else being visited.
  expectStaticTypeError('try { let n: uint8 = "s"; } catch (e: TypeError) { }');
  expectStaticTypeError('try {} catch (e: TypeError) { } finally { let n: uint8 = "s"; }');
  // A destructuring catch parameter carries its members' annotations.
  expect(ok('try {} catch ({ (a: uint8) }) { }')).toBe(true);
  // The run time is unchanged: a typed clause catches only what it matches.
  expect(evaluated('let caught = "no"; try { throw new TypeError("x"); } catch (e: TypeError) { caught = "yes"; } caught;')).toBe('yes');
});
