import { expect, test } from 'vitest';
import { evaluated, expectError } from '../harness.mts';

/**
 * `PLAN-checker-type-resolution.md`, C2's `SharedType` gap — closed.
 *
 * `shared T` is a marker over its target, and the CHECKER used to leave the
 * annotation unresolved on purpose. Resolving it made `let s: shared uint8 = 1;`
 * an early error: `IsSubtype` looks through the marker, but a numeric literal
 * reaches `uint8` by CONVERSION rather than by subtyping, and the conversion path
 * did not. So the annotation was left unreadable to avoid a false refusal, which
 * bought silence at the price of the whole annotation going unchecked.
 *
 * `literalFitsNumericType` now looks through the marker, so the annotation is
 * resolved AND judged. Both halves matter: closing the gap is only worth
 * something if the second one holds.
 */

test('a shared annotation admits what the runtime admits', () => {
  expect(evaluated('let s: shared uint8 = 1; String(s);')).toBe('1');
  expect(evaluated('function f(x: shared uint8) { return x; } String(f(1));')).toBe('1');
  expect(evaluated('class C { f: shared uint8 = 1; } String(new C().f);')).toBe('1');
});

test('and refuses what it should, which is why resolving it was worth doing', () => {
  // Unreadable annotations refuse nothing. These are the errors the gap cost.
  expectError('let s: shared uint8 = "x";');
  expectError('let s: shared uint8 = 300;');
});

test('the marker does not leak into the target relation', () => {
  // `shared uint8` and `uint8` relate through the marker, which `IsSubtype`
  // already handled - this asserts the conversion change did not disturb it.
  expect(evaluated('let s: shared uint8 = 1; let p: uint8 = s; String(p);')).toBe('1');
  expect(evaluated('let p: uint8 = 1; let s: shared uint8 = p; String(s);')).toBe('1');
});
