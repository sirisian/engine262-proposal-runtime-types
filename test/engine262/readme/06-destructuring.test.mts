import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — destructuring.
 * Sections: Destructuring Assignment Casting, Array Rest Destructuring, Object
 * Rest Destructuring, Typed return values for destructuring.
 *
 * Two boundaries are documented rather than asserted:
 *
 *  - The normative spec annotates a binding pattern's elements through
 *    SingleNameBinding (`let { a?: uint8, b: c } = o;`, `let [d: uint8] = arr;`),
 *    which the engine implements and this file verifies. The README's more
 *    elaborate parenthesized forms (`{ (a: uint8): b }`, `{ ...(y: {...}) }`)
 *    reuse the object-typing syntax and go beyond the pattern grammar the core
 *    spec fixes; those parenthesized pattern forms are not parsed and are noted
 *    as a documented gap.
 *
 *  - Typed return values for destructuring (`function f(): [uint8, uint32] {
 *    return [1, 2]; }`) require converting an array/object literal to a typed
 *    tuple/object at the boundary. That aggregate-VALUE conversion is the
 *    array/object-value runtime deferred to the memory-layout extension; the
 *    tuple and object TYPES themselves are implemented (verified in the
 *    arrays/tuples and object-typing files).
 */

// ── Array destructuring with typed elements and defaults ──────────────────────
// An array pattern annotates its elements through SingleNameBinding; a typed
// element may carry a default.
test('Array destructuring: typed elements bind their positions', () => {
  expect(evaluated('let [a: uint8, b: uint8] = [1, 2]; String(b);')).toBe('2');
  expect(evaluated('let [d: uint8] = [7]; String(d);')).toBe('7');
});

test('Array destructuring: a typed element default applies when the value is missing', () => {
  // b's position is absent, so its default is used
  expect(evaluated('let [a: uint32 = 1, b: float32 = 2] = [10]; String(a);')).toBe('10');
  expect(evaluated('let [a: uint32 = 1, b: uint32 = 2] = [10]; String(b);')).toBe('2');
});

// ── Array Rest Destructuring ──────────────────────────────────────────────────
// A rest element in an array pattern collects the remaining positions and may be
// typed as an array.
test('Array Rest Destructuring: a typed rest collects the remaining elements', () => {
  expect(evaluated('let [a: uint8, ...b: [].<uint8>] = [1, 2]; String(b.length);')).toBe('1');
  expect(evaluated('let [a: uint8, ...b: [].<uint8>] = [1, 2, 3]; String(b.length);')).toBe('2');
  // a nested rest pattern binds the same way
  expect(evaluated('let [a: uint8, ...[b: uint8]] = [1, 2]; String(b);')).toBe('2');
});

// ── Object destructuring with SingleNameBinding annotations ───────────────────
// An object pattern annotates a shorthand binding directly, and the binding may
// be optional.
test('Object destructuring: shorthand bindings take annotations and optionals', () => {
  expect(evaluated('let { a?: uint8, b: c } = { a: 5, b: 7 }; String(a) + "," + String(c);')).toBe('5,7');
  // a plain rename still works
  expect(evaluated('let { a: renamed } = { a: 9 }; String(renamed);')).toBe('9');
});

// ── Typed return values for destructuring: the TYPE side ──────────────────────
// The tuple and object return types parse and resolve; the value conversion of
// the returned literal is the deferred aggregate-value runtime.
test('Typed return for destructuring: the tuple/object return type resolves', () => {
  // the function type parses and the name is a function
  expect(evaluated('function f(): [uint8, uint32] { return [1, 2]; } typeof f;')).toBe('function');
  expect(evaluated('function f(): { a: uint8, b: float32 } { return { a: 1, b: 2 }; } typeof f;')).toBe('function');
  // the return type is the interned tuple type
  expect(ok('type R = [uint8, uint32]; type S = [uint8, uint32]; R === S;')).toBe(true);
});

// ── Documented deferrals ──────────────────────────────────────────────────────
// These record the current boundary so the deferral is visible and testable.
test('Typed return for destructuring: converting the returned literal is deferred (documents the gap)', () => {
  // Target: `const [a, b] = f()` binds a=1, b=2. Today, converting the returned
  // array [1,2] to the tuple type [uint8, uint32] at the boundary is the
  // aggregate-value runtime deferred to the memory-layout extension, so it throws.
  expectThrown('function f(): [uint8, uint32] { return [1, 2]; } const [a, b] = f(); a;');
  expectThrown('let t: [uint8, uint32] = [1, 2]; t;');
});

test('Object destructuring: the parenthesized pattern syntax binds', () => {
  // WAS a gap pin: the parenthesized `(a: type)` form did not parse. It does now,
  // and both README targets hold - `let { (a: uint8): b = 1 } = { a: 2 };` binds
  // b = 2, and the shorthand list binds each name.
  expect(evaluated('let { (a: uint8): b = 1 } = { a: 2 }; String(b);')).toBe('2');
  expect(evaluated('let { (a: uint8), (b: uint8) } = { a: 2, b: 3 }; String(a) + "," + String(b);')).toBe('2,3');
});
