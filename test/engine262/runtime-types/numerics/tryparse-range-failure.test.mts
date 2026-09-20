import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-parsing. `parse` has two failures - "a *SyntaxError* when the
 * string is not a literal of the type, and a *RangeError* when it is a literal
 * whose value the type cannot represent" - and `tryParse` answers "*null* where
 * `parse` would FAIL TO PARSE its argument".
 *
 * A range failure is not a failure to parse: the string WAS a literal of the
 * type and its value did not fit. Every family answered *null* for both, so
 * `uint8.tryParse('zz')` and `uint8.tryParse('300')` were indistinguishable and
 * a caller wanting to tell them apart had to call `parse` and catch - which is
 * what `tryParse` exists to avoid.
 *
 * The clause is not unanimous. A later sentence says a program that does not
 * know its input "writes `tryParse` and handles the *null*", which reads as
 * though nothing throws. The mechanism sentence is the precise one and governs
 * here; the other states the pair's purpose. That tension is recorded because
 * it is the reason this behaviour could reasonably have gone the other way.
 */

test('a literal out of range throws, in every family', () => {
  expectThrownKind("uint8.tryParse('300');", 'RangeError');
  // One past the maximum, where the boundary is easiest to get wrong.
  expectThrownKind("uint8.tryParse('256');", 'RangeError');
  expectThrownKind("int8.tryParse('200');", 'RangeError');
  expectThrownKind("int8.tryParse('-200');", 'RangeError');
  expectThrownKind("uint32.tryParse('5000000000');", 'RangeError');
  expectThrownKind("float16.tryParse('1e300');", 'RangeError');
  expectThrownKind("float32.tryParse('1e300');", 'RangeError');
  expectThrownKind("decimal32.tryParse('1e300');", 'RangeError');
  expectThrownKind("decimal64.tryParse('1e400');", 'RangeError');
});

test('the radix form throws too', () => {
  // The second parameter must not route around the rule.
  expectThrownKind("uint8.tryParse('1ff', 16);", 'RangeError');
  expect(evaluated("String(uint8.tryParse('ff', 16));")).toBe('255');
});

test('a string that is not a literal is still null', () => {
  expect(evaluated("String(uint8.tryParse('zz'));")).toBe('null');
  expect(evaluated("String(uint8.tryParse(''));")).toBe('null');
  expect(evaluated("String(uint8.tryParse('   '));")).toBe('null');
  expect(evaluated("String(uint8.tryParse('42abc'));")).toBe('null');
  // A non-string argument is not a literal either.
  expect(evaluated('String(uint8.tryParse(42));')).toBe('null');
  expect(evaluated("String(float16.tryParse('zz'));")).toBe('null');
  expect(evaluated("String(decimal64.tryParse('zz'));")).toBe('null');
  expect(evaluated("String(rational.tryParse('zz'));")).toBe('null');
  expect(evaluated("String(complex64.tryParse('zz'));")).toBe('null');
});

test('a successful parse is unchanged', () => {
  expect(evaluated("String(uint8.tryParse('42'));")).toBe('42');
  expect(evaluated("String(uint8.parse('255'));")).toBe('255');
  expect(evaluated("String(uint8.parse('  42  '));")).toBe('42');
  expect(evaluated("String(uint8.parse('+42'));")).toBe('42');
  expect(evaluated("String(uint8.parse('1_0'));")).toBe('10');
  expect(evaluated("String(int8.parse('-42'));")).toBe('-42');
  expect(evaluated("String(float16.parse('1.5'));")).toBe('1.5');
  expect(evaluated("String(float16.parse('0.1'));")).toBe('0.0999755859375');
  expect(evaluated("String(decimal64.parse('1.5'));")).toBe('1.5');
  expect(evaluated("String(rational.parse('1/2'));")).toBe('1/2');
  expect(evaluated("String(complex64.parse('1+2i'));")).toBe('1+2i');
});

test("`parse`'s own two failures are unchanged", () => {
  expectThrownKind("uint8.parse('zz');", 'SyntaxError');
  expectThrownKind("uint8.parse('300');", 'RangeError');
  expectThrownKind("uint8.parse('1ff', 16);", 'RangeError');
  expectThrownKind("float16.parse('1e300');", 'RangeError');
  expectThrownKind("decimal32.parse('1e300');", 'RangeError');
});

test('misuse of the method is still not a parse failure', () => {
  // "A call that is not a parse at all, because the receiver is not a numeric
  // type, throws as `parse` does rather than answering *null*: that is a
  // mistake in the program, and reporting it as a failed parse would name the
  // wrong thing."
  expectThrownKind("(5).tryParse('1');", 'TypeError');
  expectThrownKind("string.tryParse('1');", 'TypeError');
});

test('a known-wrong float64 case, pinned', () => {
  // `float64.parse('1e400')` SATURATES rather than raising, so its `tryParse`
  // has nothing to let through. The narrow widths refuse because of an earlier
  // change to `fitsNumericType` that did not reach `float64`, so the family
  // disagrees with itself. Out of scope here and pinned so a later change
  // cannot adopt it silently.
  expect(evaluated("String(float64.tryParse('1e400'));")).toBe('Infinity');
  expect(evaluated("String(float64.parse('1e400'));")).toBe('Infinity');
});
