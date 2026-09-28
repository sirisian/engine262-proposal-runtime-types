import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-span-type: copying methods return owned arrays of the same element type.
test('a slice of a span is an independent owned array', () => {
  expect(evaluated('function copy(s: Span.<uint8>): [].<uint8> { return s.slice(1); } let a: [].<uint8> = [1,2,3]; const b = copy(a); b.push(4); b[0] = 9; a.join(",") + "|" + b.join(",");')).toBe('1,2,3|9,3,4');
});

test('a span copy preserves its element contract', () => {
  expectStaticTypeError('function copy(s: Span.<uint8>): [].<string> { return s.slice(); }');
});
