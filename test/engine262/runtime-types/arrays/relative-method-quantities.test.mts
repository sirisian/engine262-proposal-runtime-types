import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each(['-1', '-1.8', '"-1"', 'int8(-1)', 'int64(-1)', '{ valueOf() { return -1; } }'])('at accepts the relative quantity %s', (index) => {
  expect(evaluated(`const a: [].<uint8> = [4, 9]; String(a.at(${index}));`)).toBe('9');
});

test.each(['', 'undefined', 'null', 'false', 'NaN', '-0', 'uint64(0)'])('at keeps ordinary zero selection for %s', (index) => {
  expect(evaluated(`const a: [].<uint8> = [4, 9]; String(a.at(${index}));`)).toBe('4');
});

test.each(['-3', '2', 'Infinity', '-Infinity'])('at answers undefined for the missing position %s', (index) => {
  expect(evaluated(`const a: [].<uint8> = [4, 9]; String(a.at(${index}));`)).toBe('undefined');
});

test('at publishes its possible missing result', () => {
  expectStaticTypeError('function f(a: [].<uint8>, i: number): uint8 { return a.at(i); }');
  expect(ok('function f(a: [].<uint8>, i: number): uint8 | undefined { return a.at(i); }')).toBe(true);
  expect(evaluated('const a: [uint8, string] = [4, "last"]; String(a.at(-1));')).toBe('last');
});

test('relative positions preserve coercion count and errors', () => {
  expect(evaluated(`let calls = 0; const a: [].<uint8> = [4, 9];
    const index = { valueOf() { calls++; return -1; } };
    String(a.at(index)) + '/' + String(calls);`)).toBe('9/1');
  expect(evaluated(`const a: [].<uint8> = [4, 9]; let marker = 'no';
    try { a.at({ valueOf() { throw 'index'; } }); } catch (e) { marker = e; } marker;`)).toBe('index');
});

test.each(['includes', 'indexOf', 'lastIndexOf'])('%s admits a signed fromIndex while enforcing its element contract', (method) => {
  const expected = method === 'includes' ? 'true' : '1';
  expect(evaluated(`const a: [].<uint8> = [4, 9]; String(a.${method}(9, int8(-1)));`)).toBe(expected);
  expectStaticTypeError(`const a: [].<uint8> = [4, 9]; a.${method}("bad", -1);`);
});

test('fill and splice preserve relative bounds and stored element contracts', () => {
  expect(evaluated('const a: [].<uint8> = [4, 9]; a.fill(7, -1); a.join(",");')).toBe('4,7');
  expect(evaluated('const a: [].<uint8> = [4, 9]; a.splice(int8(-1), uint8(1), 7); a.join(",");')).toBe('4,7');
  expectStaticTypeError('const a: [].<uint8> = [4, 9]; a.fill("bad", -1);');
  expectStaticTypeError('const a: [].<uint8> = [4, 9]; a.splice(-1, 1, "bad");');
});
