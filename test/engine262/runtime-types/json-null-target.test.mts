import { expect, test } from 'vitest';
import { evaluated, expectThrown } from './harness.mts';

/**
 * Spec: #sec-coercejsonvalue's primitive case, and #sec-null-and-undefined-
 * types.
 *
 * > `null` is the type whose one value is *null*. It is described by the Type
 * > Record { [[Kind]]: ~primitive~, [[Name]]: *"null"*, [[Arguments]]: « » }.
 *
 * The operation's primitive case handled a numeric type, `string` and
 * `boolean`, and not this one. A JSON `null` and the `null` type mean the same
 * thing, so nothing had to be decided - the case was missing.
 *
 * Its absence reached far past the bare target. The union case returns the
 * first member that converts, so a `null` member could never convert and NO
 * SPELLING OF A NULLABLE FIELD WORKED: a document containing `null` anywhere
 * could only be typed by giving that position `any`, abandoning the schema
 * exactly where one is wanted. Every diagnostic refuted itself - "expected null
 * or uint8, got null".
 */

test('a JSON null satisfies a null target', () => {
  expect(evaluated("String(JSON.parse.<null>('null'));")).toBe('null');
  expectThrown("JSON.parse.<null>('1');", 'expected null');
});

test('every spelling of a nullable field works', () => {
  // The bare union.
  expect(evaluated("String(JSON.parse.<uint8 | null>('null'));")).toBe('null');
  expect(evaluated("String(JSON.parse.<uint8 | null>('1'));")).toBe('1');
  // Inside an object, which is the ordinary shape of a nullable field.
  expect(evaluated('String(JSON.parse.<{ a: uint8 | null }>(\'{"a":null}\').a);')).toBe('null');
  expect(evaluated('String(JSON.parse.<{ a: uint8 | null }>(\'{"a":1}\').a);')).toBe('1');
  // Inside an array.
  expect(evaluated("String(JSON.parse.<[].<uint8 | null>>('[1,null]')[1]);")).toBe('null');
  // And over a non-numeric member, since the union tries each in turn.
  expect(evaluated("String(JSON.parse.<string | null>('null'));")).toBe('null');
});

test('`undefined` stays refused, and correctly so', () => {
  // JSON has no `undefined` token, so no document produces one and there is
  // nothing to accept. Its absence is right where `null`'s was an omission.
  expectThrown("JSON.parse.<undefined>('null');", 'expected undefined');
});

test('an explicit null does not satisfy an optional member', () => {
  // `{ a?: uint8 }` means the key may be ABSENT, not that it may be null. A
  // document wanting both writes `{ a?: uint8 | null }`.
  expectThrown('JSON.parse.<{ a?: uint8 }>(\'{"a":null}\');', 'expected uint8');
  expect(evaluated("String(JSON.parse.<{ a?: uint8 }>('{}').a);")).toBe('undefined');
});

test('the other primitive targets are unchanged', () => {
  expect(evaluated("String(JSON.parse.<string>('\"hi\"'));")).toBe('hi');
  expect(evaluated("String(JSON.parse.<boolean>('true'));")).toBe('true');
  expect(evaluated("String(JSON.parse.<uint8>('42'));")).toBe('42');
  expectThrown("JSON.parse.<bigint>('42');", 'expected bigint');
});
