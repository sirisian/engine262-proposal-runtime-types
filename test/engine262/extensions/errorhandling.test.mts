import { test, expect } from 'vitest';
import { evaluated, bool } from '../readme/harness.mts';

/**
 * Extension coverage — errorhandling.md (typed catch).
 *
 * Typed catch clauses are implemented: a `catch (e: T)` runs only when the thrown
 * value satisfies T, clauses are tried in order, an untyped clause catches the
 * rest, the binding is narrowed within a typed clause, and an unmatched value
 * propagates. Now that the built-in error constructors are registered as type
 * names, typed catch works with them (TypeError, RangeError, and the rest) as well
 * as with user classes and primitive types.
 */

// ── Typed catch by built-in error type ────────────────────────────────────────
test('typed catch: a clause runs when the thrown value satisfies its type', () => {
  expect(evaluated('let r = "none"; try { throw new TypeError("x"); } catch (e: TypeError) { r = "caught"; } r;')).toBe('caught');
});

test('typed catch: clauses are tried in order and the first match runs', () => {
  expect(evaluated('let r = "none"; try { throw new RangeError("x"); } catch (e: TypeError) { r = "t"; } catch (e: RangeError) { r = "range"; } r;')).toBe('range');
});

test('typed catch: an untyped clause at the end catches the rest', () => {
  expect(evaluated('let r = "none"; try { throw new EvalError("x"); } catch (e: TypeError) { r = "t"; } catch (e) { r = "fallback"; } r;')).toBe('fallback');
});

test('typed catch: an unmatched value propagates to the enclosing handler', () => {
  expect(evaluated('let r = "none"; try { try { throw new RangeError("x"); } catch (e: TypeError) { r = "wrong"; } } catch (e) { r = "outer"; } r;')).toBe('outer');
});

// ── Narrowing within a typed clause ───────────────────────────────────────────
test('typed catch: the binding is narrowed to the clause type', () => {
  // e.message is available without a cast
  expect(evaluated('let r = "none"; try { throw new TypeError("msg"); } catch (e: TypeError) { r = e.message; } r;')).toBe('msg');
});

// ── Typed catch by user class and by the Error base ───────────────────────────
test('typed catch: works with a user class type', () => {
  expect(evaluated('class MyErr {} let r = "none"; try { throw new MyErr(); } catch (e: MyErr) { r = "caught"; } r;')).toBe('caught');
});

test('typed catch: a base Error clause catches a subclass error', () => {
  // TypeError is an Error, so a catch (e: Error) catches it (membership by chain)
  expect(evaluated('let r = "none"; try { throw new TypeError("x"); } catch (e: Error) { r = "base"; } r;')).toBe('base');
  expect(bool('let e = new RangeError("x"); String(e instanceof Error);')).toBe(true);
});

// ── The errors a typed program raises are the standard ones ───────────────────
test('typed catch: a failed parse throws a catchable RangeError', () => {
  // uint8.parse('256') is a RangeError, catchable by type
  expect(evaluated('let r = "none"; try { uint8.parse("256"); } catch (e: RangeError) { r = "range"; } r;')).toBe('range');
});
