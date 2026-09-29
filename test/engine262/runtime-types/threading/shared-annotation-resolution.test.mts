import { expect, test } from 'vitest';
import { evaluated, expectError } from '../harness.mts';

/**
 * Spec: #sec-threading-shared-modifier (RequireType enforces a `shared` type by
 * enforcing its target) and #sec-type-annotations.
 *
 * A `shared T` annotation is resolved and judged exactly as `T` is. A numeric
 * literal reaches `shared uint8` by conversion, as it reaches `uint8`, so
 * `let s: shared uint8 = 1;` is accepted, while a string or an out-of-range literal
 * is refused before the source runs. An annotation the checker cannot read refuses
 * nothing, so the refusals are asserted as well as the acceptances.
 */

test('a shared annotation admits what the runtime admits', () => {
  expect(evaluated('let s: shared uint8 = 1; String(s);')).toBe('1');
  expect(evaluated('function f(x: shared uint8) { return x; } String(f(1));')).toBe('1');
  expect(evaluated('class C { f: shared uint8 = 1; } String(new C().f);')).toBe('1');
});

test('and refuses what it should, which is why resolving it was worth doing', () => {
  // An annotation the checker cannot read refuses nothing, so these refusals show
  // that it is read.
  expectError('let s: shared uint8 = "x";');
  expectError('let s: shared uint8 = 300;');
});

test('the marker does not leak into the target relation', () => {
  // `shared uint8` and `uint8` relate through the marker in both directions
  // (#sec-threading-shared-modifier), and a literal's conversion does not disturb
  // that.
  expect(evaluated('let s: shared uint8 = 1; let p: uint8 = s; String(p);')).toBe('1');
  expect(evaluated('let p: uint8 = 1; let s: shared uint8 = p; String(s);')).toBe('1');
});
