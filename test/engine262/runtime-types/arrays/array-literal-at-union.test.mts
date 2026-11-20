import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * #sec-contextual-types: an array literal at a union is typed against the array
 * or tuple member it fits, as an object literal is typed against the
 * alternative it satisfies and a numeric literal takes the member it fits
 * (#sec-literal-propagation). The literal was typed `[].<number>` before any
 * member was asked, so `const a: [].<uint8> | null = [3]` was refused, while
 * the same array arriving through `any` was built as the member when it ran.
 */

const typeOf = (type: string, literal: string) => `const a: ${type} = ${literal}; String(Reflect.typeOf(a));`;

test('an array literal takes the one array or tuple member of a union', () => {
  expect(evaluated(typeOf('[].<uint8> | null', '[3]'))).toBe('[].<uint.<8>>');
  expect(evaluated(typeOf('[].<uint8> | undefined', '[3, 4]'))).toBe('[].<uint.<8>>');
  expect(evaluated(typeOf('[].<uint8> | string', '[3]'))).toBe('[].<uint.<8>>');
  expect(evaluated(typeOf('uint8 | [].<uint8>', '[3]'))).toBe('[].<uint.<8>>');
  expect(evaluated(typeOf('[2].<uint8> | null', '[1, 2]'))).toBe('[2].<uint.<8>>');
  expect(evaluated('const t: [uint8, string] | null = [1, "a"]; t === null ? "" : String(Reflect.typeOf(t[0])) + t[1];')).toBe('uint.<8>a');
  // At every depth, as at the member alone.
  expect(evaluated(typeOf('[].<[].<uint8> | null>', '[[1], null]'))).toBe('[].<null | [].<uint.<8>>>');
  expect(evaluated('function f(x: [].<uint8> | null) { return String(Reflect.typeOf(x)); } f([3]);')).toBe('[].<uint.<8>>');
  expect(evaluated('function f(): [].<uint8> | null { return [3]; } String(Reflect.typeOf(f()));')).toBe('[].<uint.<8>>');
});

test('with several such members, one its elements fit', () => {
  expect(evaluated(typeOf('[].<uint8> | [].<string>', '["s"]'))).toBe('[].<string>');
  expect(evaluated(typeOf('[].<uint8> | [].<uint16>', '[300]'))).toBe('[].<uint.<16>>');
});

test('a literal the member refuses is refused as it is at the member', () => {
  expectStaticTypeError('const a: [].<uint8> | null = [300];');
  expectStaticTypeError('const a: [].<uint8> | null = ["s"];');
  expectStaticTypeError('const a: [2].<uint8> | null = [1, 2, 3];');
  expectStaticTypeError('const t: [uint8, string] | null = [1, 2];');
  // A union with no array member still refuses an array.
  expectThrown('const a: uint8 | string = [3];', 'is not assignable to');
});
