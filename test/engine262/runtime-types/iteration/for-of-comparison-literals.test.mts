import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A COMPARISON WITH AN UNTYPED LITERAL does not block inference when the literal is a
 * value of the inferred type.
 *
 * Every comparison with an untyped literal used to block, so `if (i > 5) s.add(i)`
 * left `i` a `number` - and guarded returns, the commonest shape of `return i`, were
 * never inferred. The reason was real: `if (i < 300) return i` in a `(): uint8`
 * function works, and inferring `i` a `uint8` would make `300` a `uint8`, which it
 * cannot be - so a working program would become a refused one.
 *
 * A comparison's result is a boolean, so a narrower binding cannot change what it
 * says, PROVIDED the literal is a value of that type. So the type is decided from the
 * other uses first, and then each comparison literal is checked against it: `5` is a
 * `uint8` and does not block; `300` is not, and blocks, leaving `i` a `number` exactly
 * as before.
 *
 * Only comparisons. `i * 200` changes with the type - a `uint8` wraps it to 144 - and
 * still blocks. And only an integer literal against a sized integer type; anything
 * else is not decided here and keeps blocking.
 */

const T = "let t = '';";
const S = 'const s = new Set.<uint32>();';

test('a fitting literal in a comparison does not block', () => {
  expect(evaluated(`${T} ${S} for (const i of 0..<3) { if (i > 5) s.add(i); t = String(Reflect.typeOf(i)); } t;`))
    .toBe('uint.<32>');
});

test('equality counts as a comparison', () => {
  expect(evaluated(`${T} ${S} for (const i of 0..<3) { if (i === 2) s.add(i); t = String(Reflect.typeOf(i)); } t;`))
    .toBe('uint.<32>');
});

test('a guarded return is inferred', () => {
  expect(evaluated(`${T} function h(): uint8 { for (const i of 0..<3) { t = String(Reflect.typeOf(i)); `
    + 'if (i > 5) return i; } return 0; } h(); t;')).toBe('uint.<8>');
});

test('a literal that does not fit still blocks, and the program still works', () => {
  // THE GUARD against dropping the check. Were every comparison let through, `i`
  // would be a `uint8` here, `300` would have to be one, and this program - which
  // works - would be refused.
  const program = 'function h(): uint8 { for (const i of 0..<3) { t = String(Reflect.typeOf(i)); '
    + 'if (i < 300) return i; } return 0; }';
  expect(evaluated(`${T} ${program} String(h());`)).toBe('0');
  expect(evaluated(`${T} ${program} h(); t;`)).toBe('number');
});

test('arithmetic with a literal still blocks', () => {
  // A narrower `i` would change this: as a `uint8`, `i * 200` is 144, not 400.
  expect(evaluated(`${T} const b: [].<uint8> = []; for (const i of 2..<3) { b.push(i); t = String(i * 200); } t;`))
    .toBe('400');
});

test('what is not decided here keeps blocking', () => {
  // A negative literal is not a NumericLiteral node, and a float target has no integer
  // bounds; both stay as they were.
  expect(evaluated(`${T} const s = new Set.<int32>(); for (const i of 0..<3) { if (i > -1) s.add(i); `
    + 't = String(Reflect.typeOf(i)); } t;')).toBe('number');
  expect(evaluated(`${T} function h(): float32 { for (const i of 0..<3) { t = String(Reflect.typeOf(i)); `
    + 'if (i > 5) return i; } return 0; } h(); t;')).toBe('number');
});

test('a comparison alone asks for no type', () => {
  expect(evaluated(`${T} for (const i of 0..<3) { if (i > 5) {} t = String(Reflect.typeOf(i)); } t;`)).toBe('number');
});
