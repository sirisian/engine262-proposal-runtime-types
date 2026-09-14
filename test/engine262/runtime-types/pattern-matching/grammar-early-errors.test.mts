import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

test.each([
  ['1', 'let x and let x'],
  ['[1, 2]', '[let x, let x]'],
  ['{a: 1, b: 2}', '{a: let x, b: let x}'],
  ['{a: 1, b: 2}', '{a: let x, ...let x}'],
  ['1', 'let x or let y'],
  ['[1, 2]', '[let x or let x, let x]'],
])('invalid binding set in %s is rejected before execution', (subject, pattern) => {
  const body = `match (${subject}) { when ${pattern}: 1; default: 0; };`;
  expectEarlyError(body, 'SyntaxError');
  expectEarlyError(`function unused() { ${body} }`, 'SyntaxError');
  expectEarlyError(`if ((${subject}) is ${pattern}) { 1; }`, 'SyntaxError');
});

test('or merges one binding and distinct simultaneous names remain valid', () => {
  expect(evaluated('const x = 9; String(match (1) { when let x or let x: x; default: 0; });')).toBe('1');
  expect(evaluated('String(match (1) { when let x and let y: x + y; default: 0; });')).toBe('2');
  expectEarlyError('match (1) { when ${match (1) { when let x and let x: 1; default: 0; }}: 1; default: 0; };', 'SyntaxError');
});

test.each(['1 + 2', 'true && false', '1..<(2 + 3)', '1..<2 + 3'])('literal cover refuses %s', (pattern) => {
  expectEarlyError(`function unused() { match (3) { when ${pattern}: 1; default: 0; }; }`, 'SyntaxError');
});

test('literal patterns retain interpolation, signs, and named range endpoints', () => {
  expect(evaluated('String(match (3) { when ${1 + 2}: 1; default: 0; });')).toBe('1');
  expect(evaluated('String(match (-2) { when -2: 1; default: 0; });')).toBe('1');
  expect(evaluated('const END = 3; String(match (2) { when 1..<END: 1; default: 0; });')).toBe('1');
});
