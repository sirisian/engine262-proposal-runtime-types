import { expect, test } from 'vitest';
import {
  evaluated, expectError, expectStaticTypeError, expectThrownKind,
} from '../harness.mts';

/**
 * proposal-runtime-types `#sec-lexical-declarations`: the `const`-needs-an-
 * initializer early error is AMENDED, not preserved.
 *
 * "A `const` declaration without an |Initializer| is a Syntax Error where the
 * binding carries no |TypeAnnotation|, as it is in ECMA-262: the Early Errors of
 * |LexicalDeclaration| are amended so that the rule … does not apply to a
 * |LexicalBinding| whose |BindingIdentifier| carries one. Such a binding is
 * initialized to the default value of its type, exactly as a `let` binding of
 * that type is, and it is a type error where that type has no default."
 *
 * This went untested. `annotations.test.mts` asserted the UNAMENDED rule -
 * `expectParseError('const k: uint8;'); // const still requires an initializer` -
 * and failed for the whole life of that assertion, so the amendment was covered
 * by a test that contradicted it and by nothing else.
 */

test('an annotated `const` may omit its initializer', () => {
  expect(evaluated('const k: uint8; String(k);')).toBe('0');
  expect(evaluated('const k: string; String(JSON.stringify(k));')).toBe('""');
  expect(evaluated('const k: boolean; String(k);')).toBe('false');
});

test('an UNannotated `const` still may not', () => {
  // The half of ECMA-262's rule the amendment leaves in place.
  // A Syntax Error, so it never runs - which is what `expectError` asserts.
  expectError('const k;');
});

test('the binding is a real one of its type, and still constant', () => {
  expect(evaluated('const k: uint8; String(Reflect.typeOf(k) === uint8);')).toBe('true');
  expectThrownKind('const k: uint8; k = 5;', 'TypeError');
});

test('a type with no default is a type error', () => {
  // The other half of the amendment, which is what stops it from being a way to
  // conjure a value of a type that has none.
  // EARLY, not a run-time throw: the checker knows the annotation has no default
  // before anything runs, which is where an error about a declaration belongs.
  expectStaticTypeError('const k: never;');
  expectStaticTypeError('const k: { a: uint8 };');
});

test('`let` behaves the same, which is what the amendment appeals to', () => {
  expect(evaluated('let j: uint8; String(j);')).toBe('0');
  expectStaticTypeError('let j: never;');
});
