import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-engine-decorator-replacement §2.2: context coverage.
 *
 * 43 reflection contexts is too many to write 43 macros for and does not need
 * them. ONE macro reads what arrived; the matrix is one row per context.
 *
 * **The assertion is the KIND SEQUENCE, not the text** — a kind sequence is
 * stable against whitespace and says the tokenizer segmented correctly, where
 * asserting text would be testing `toString` instead.
 */

const COUNT = 'function count(c) { globalThis.__k = c.kind; '
  + 'globalThis.__t = c.block ? c.block.map(function (t) { return t.kind; }).join(",") : ""; } ';

const kindOf = (program: string): string => evaluated(`${COUNT}${program} globalThis.__k;`);

test('the CLASS family', () => {
  expect(kindOf('@count class A {}')).toBe('Class');
  expect(kindOf('class A { @count x: uint8 = 1; }')).toBe('ClassField');
  expect(kindOf('class A { @count m() {} }')).toBe('ClassMethod');
  expect(kindOf('class A { @count get g() { return 1; } }')).toBe('ClassGetter');
  expect(kindOf('class A { @count set s(v) {} }')).toBe('ClassSetter');
  expect(kindOf('class A { @count accessor a: uint8 = 1; }')).toBe('ClassAccessor');
});

test('the SUB-TARGET family — parameters and returns', () => {
  expect(kindOf('class A { m(@count x: uint8) {} }')).toBe('ClassMethodParameter');
  expect(kindOf('class A { m(): @count uint8 { return uint8(1); } }')).toBe('ClassMethodReturn');
  expect(kindOf('class A { get g(): @count uint8 { return uint8(1); } }')).toBe('ClassGetterReturn');
  expect(kindOf('class A { set s(@count v: uint8) {} }')).toBe('ClassSetterParameter');
});

test('the FUNCTION family', () => {
  expect(kindOf('@count function f() {}')).toBe('Function');
  expect(kindOf('function f(@count x: uint8) {}')).toBe('FunctionParameter');
  expect(kindOf('function f(): @count uint8 { return uint8(1); }')).toBe('FunctionReturn');
});

test('the DECLARATION family', () => {
  expect(kindOf('@count let x = 1;')).toBe('Let');
  expect(kindOf('@count const y = 1;')).toBe('Const');
  expect(kindOf('@count enum E { A }')).toBe('Enum');
});

test('the BLOCK family — all nine reachable forms', () => {
  // The decorator goes on the BLOCK, and the context is chosen by the block's
  // POSITION. That is why `IfBlockReflection` carries a `condition` the
  // decorator did not write.
  expect(kindOf('@count { let x = 1; }')).toBe('Block');
  expect(kindOf('if (true) @count { 1; }')).toBe('IfBlock');
  expect(kindOf('if (false) {} else @count { 1; }')).toBe('ElseBlock');
  expect(kindOf('if (false) {} else if (true) @count { 1; }')).toBe('ElseIfBlock');
  // A loop body's decorator does not run if the loop does not ENTER — a block
  // decorator fires per entry, so every loop row must actually iterate.
  expect(kindOf('let n = 0; while (n < 1) @count { n += 1; }')).toBe('WhileBlock');
  expect(kindOf('let n = 0; do @count { n += 1; } while (false);')).toBe('DoWhileBlock');
  expect(kindOf('for (let i = 0; i < 1; i++) @count { 1; }')).toBe('ForBlock');
  expect(kindOf('for (const k in { a: 1 }) @count { 1; }')).toBe('ForInBlock');
  expect(kindOf('for (const v of [1]) @count { 1; }')).toBe('ForOfBlock');
});

test('every block context receives its BLOCK as tokens', () => {
  // One assertion per shape rather than per form: the block is ONE group token,
  // so a macro cannot lose a brace whatever the enclosing statement was.
  expect(evaluated(`${COUNT}@count { let x = 1; } globalThis.__t;`)).toBe('group');
  expect(evaluated(`${COUNT}if (true) @count { 1; } globalThis.__t;`)).toBe('group');
  expect(evaluated(`${COUNT}for (const v of [1]) @count { 1; } globalThis.__t;`)).toBe('group');
});
