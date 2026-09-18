import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

/**
 * Spec: #sec-parsing with #sec-type-errors.
 *
 * "A `string` is deliberately not a conversion source for a numeric type, so
 * `let c: uint8 = '1';` is a type error and the parse is always written;
 * #sec-convertvalue is where that is enforced, and it is enforced at the
 * explicit conversion too, so `'1' := uint8` is a type error for the same
 * reason."
 *
 * "For the same reason" - and the three spellings of the rule did not get the
 * same answer. The annotation was refused before the source ran; the Type Object
 * call `uint8('1')` was too; the `:=` cast threw only when it evaluated, so
 * `('1' := uint8)` inside a function nothing called raised nothing at all. All
 * three are now decided in the checking pass.
 */

test('a string source at a numeric conversion target is refused', () => {
  expectStaticTypeError("let x = ('1' := uint8);");
  expectStaticTypeError("let x = ('1.5' := float32);");
  // The source need not be a literal; a binding of string type is the same.
  expectStaticTypeError("let s: string = '1'; let x = (s := uint8);");
  // A template literal is a string.
  expectStaticTypeError('let x = (`1` := uint8);');
});

test('the refusal does not wait for the conversion to run', () => {
  expectStaticTypeError("function f() { return ('1' := uint8); }");
  expectStaticTypeError("class C { m(): uint8 { return ('1' := uint8); } }");
});

test('the three spellings agree', () => {
  // The two that already agreed, pinned so they cannot drift apart again.
  expectStaticTypeError("let c: uint8 = '1';");
  expectStaticTypeError("let x = uint8('1');");
});

test('the parse forms are what the clause says to write', () => {
  // "the parse is always written" - the rule exists to send a reader here.
  expect(evaluated("let x = uint8.parse('1'); String(x);")).toBe('1');
  expect(evaluated("let x = uint8.tryParse('1'); String(x !== null);")).toBe('true');
});

test('the rule reaches the sized value types and stops there', () => {
  // #sec-convertvalue reaches the string refusal only for `int`, `uint` and the
  // binary floats. `number`, `bigint` and `boolean` are earlier cases of that
  // operation and perform "the ordinary primitive conversions".
  expectStaticTypeError("let x = ('5' := int32);");
  expectStaticTypeError("let x = ('5' := float128);");
  expect(evaluated("String(('5' := number) === 5);")).toBe('true');
  expect(evaluated("let x = number('5'); String(x);")).toBe('5');
  expect(evaluated("let x = ('5' := boolean); String(x);")).toBe('true');
});

test('conversions that are not from a string are untouched', () => {
  expect(evaluated('let x = (1 := uint8); String(x);')).toBe('1');
  expect(evaluated('let a: uint16 = 300; let x = (a := uint32); String(x);')).toBe('300');
  // A string target takes a string source; the rule is about NUMERIC targets.
  expect(evaluated("let x = ('1' := string); x;")).toBe('1');
  // A union source that a numeric conversion can accept is not a string source.
  expect(evaluated('let s: string | uint8 = 1; let x = (s := uint8); String(x);')).toBe('1');
  // An unbound type parameter says nothing yet, so the declaration stands.
  expect(ok('function f<T>(v: T) { return (v := uint8); }')).toBe(true);
});

test('a source the checker cannot see is judged at run time', () => {
  // The `any` boundary, which #sec-type-errors reserves a thrown error for. The
  // static move must not have removed the runtime half.
  expectThrownKind("let s: any = '1'; let x = (s := uint8);", 'TypeError');
});
