import { test } from 'vitest';
import { expectThrown } from '../harness.mts';

/**
 * A literal beside an integer or a binary float whose type only the run time
 * knows is refused naming the literal as it is written, as the checker names
 * it and as a literal beside a decimal, a rational or a `float128` is named
 * when it runs. The message printed the Number, unquoted: `1e39` as `1e+39`.
 * A named constant is named by its value, which its name does not show, and a
 * constant computed as a Number keeps the clause that says so.
 */

const U = (value: string, body: string) => `function f(x) { ${body} } f(${value});`;

test('a literal operand is named as it is written', () => {
  expectThrown(U('float32(1)', 'return x * 1e39;'), '"1e39" is not in the range of "float32"');
  expectThrown(U('float16(1)', 'return x * 1e5;'), '"1e5" is not in the range of "float16"');
  expectThrown(U('uint8(1)', 'return x * 0x1FF;'), '"0x1FF" is not in the range of "uint.<8>"');
  expectThrown(U('int8(1)', 'return x * -129;'), '"-129" is not in the range of "int.<8>"');
  expectThrown(U('uint8(1)', 'return x + (200 + 100);'), '"200 + 100" is not in the range of "uint.<8>"');
  expectThrown(U('uint8(1)', 'return x < 300;'), '"300" is not in the range of "uint.<8>"');
  expectThrown(U('uint8(1)', 'x += 300; return x;'), '"300" is not in the range of "uint.<8>"');
  expectThrown(U('float32(1)', 'x += 1e39; return x;'), '"1e39" is not in the range of "float32"');
});

test('a named constant is named by its value', () => {
  expectThrown(`const K = 300; ${U('uint8(1)', 'return x + K;')}`, '"300" is not in the range of "uint.<8>"');
});

test('a constant computed as a Number says so', () => {
  expectThrown(U('uint8(3)', 'return x * (7 / 2);'), '3.5 is not in the range of "uint.<8>"; no type is declared where this constant is written');
  expectThrown(U('uint8(3)', 'x += 7 / 2; return x;'), '3.5 is not in the range of "uint.<8>"; no type is declared where this constant is written');
});
