import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

/**
 * AN UNANNOTATED `for`-`of` BINDING OVER A LITERAL ITERABLE TAKES THE TYPE ITS
 * USES ASK FOR, as though it had been annotated with it.
 *
 * `for (const i of 0..<3) s.add(i)` for a `Set.<uint32>` was refused, `"number" is
 * not assignable to "uint.<32>"`, while `0..<n`, `(0..<3).step(1)` and an untyped
 * array binding were all accepted. The checker refused exactly where it KNEW the
 * element was a `number` - the literal forms - so the most precisely typed loops
 * were the only ones that failed.
 *
 * The type is decided BEFORE the body is walked, from the part of each use that is
 * not the binding: the callee of `s.add(i)`, the annotation of `let x: uint8 = i`,
 * the target of `x = i`, the other operand of `a + i`. It is supplied where a
 * written annotation is, so the annotated path does the rest - retyping the literal,
 * the element rule's range check, and at run time converting each element.
 *
 * Deciding after the walk does not work: during one walk the binding would be a
 * `number`, so `a + i` would carry a `number`-derived type on, and
 * `const r: uint8 = a + i` would be refused falsely. And the run-time half is not
 * optional: with the checker alone, `a + i` passed the checker and was then refused
 * at run time mixing a `number` with a `uint8`.
 *
 * The binding is NOT inferred where that could change a result - it stays a
 * `number`, exactly as without this - when `i` is an operand whose other operand is
 * untyped (`i * 200`), when uses disagree, or when nothing asks for a type.
 */

const L = (body: string, pre = '', iterable = '0..<3') =>
  `${pre} let t = ''; for (const i of ${iterable}) { ${body} t = String(Reflect.typeOf(i)); } t;`;

test('the headline: a use asks for the type, and the loop is accepted', () => {
  expect(evaluated(L('s.add(i);', 'const s = new Set.<uint32>();'))).toBe('uint.<32>');
});

test('each position that asks for a numeric type infers it', () => {
  expect(evaluated(L('let x: uint8 = i;'))).toBe('uint.<8>');
  expect(evaluated(L('f(i);', 'function f(x: uint8) {}'))).toBe('uint.<8>');
  expect(evaluated(L('x = i;', 'let x: uint8 = 0;'))).toBe('uint.<8>');
});

test('a binary operand takes the other operand\'s type, on either side', () => {
  // #sec-contextual-types gives the position the type; a literal already takes it.
  // This extends that to the loop binding.
  expect(evaluated(L('const r = a + i;', 'const a: uint8 = 1;'))).toBe('uint.<8>');
  expect(evaluated(L('const r = i + a;', 'const a: uint8 = 1;'))).toBe('uint.<8>');
});

test('an expression built from the binding flows on at the inferred type', () => {
  // The case a decide-after-the-walk design gets wrong: `a + i` must be a `uint8`
  // by the time it reaches the annotation.
  expect(evaluated(L('const r: uint8 = a + i;', 'const a: uint8 = 1;'))).toBe('uint.<8>');
});

test('the run time applies the inferred type, not only the checker', () => {
  // Without the run-time half this passed the checker and was refused when run.
  expect(ok('const a: uint8 = 1; for (const i of 0..<3) { const r = a + i; }')).toBe(true);
});

test('uses that agree, an array literal, and a parenthesized range', () => {
  expect(evaluated(L('s.add(i); u.add(i);', 'const s = new Set.<uint32>(); const u = new Set.<uint32>();')))
    .toBe('uint.<32>');
  expect(evaluated(L('s.add(i);', 'const s = new Set.<uint32>();', '[1, 2, 3]'))).toBe('uint.<32>');
  expect(evaluated(L('s.add(i);', 'const s = new Set.<uint32>();', '(0..<3)'))).toBe('uint.<32>');
});

test('the range is checked against the inferred type before the program runs', () => {
  // Retyping the literal with the inferred type brings the element rule with it.
  expectStaticTypeError('const s = new Set.<uint8>(); for (const i of 0..<300) s.add(i);');
  expectStaticTypeError('const s = new Set.<uint32>(); for (const i of -1..<3) s.add(i);');
});

test('with no typed use, arithmetic keeps its number result', () => {
  // Nothing here asks for a type, so nothing is inferred and `i * 200` is 400. This
  // pins the result; it does NOT exercise blocking, since with no typed use there is
  // nothing to block. The blocking test is the one below that pairs a typed use
  // with `i * 200`. (As a `uint8`, `i * 200` would wrap to 144.)
  expect(evaluated('let r = 0; for (const i of 2..<3) { r = i * 200; } String(r);')).toBe('400');
});

test('a typed use does not silently change arithmetic elsewhere in the loop', () => {
  // THE BLOCKING TEST - the only one here that pairs a typed use with arithmetic on
  // an untyped operand, so the only one that fails if blocking is removed (measured).
  // The hazard inference must not introduce. `b.push(i)` asks for a `uint8`; were
  // `i` inferred one, `i * 200` would silently become 144. Instead inference is
  // blocked, `i` stays a `number`, and the typed use is refused - exactly as today.
  expectStaticTypeError('const b: [].<uint8> = []; let t = 0; for (const i of 2..<3) { b.push(i); t = t + i * 200; }');
});

test('an argument built from the binding does not infer from the call', () => {
  // The argument is `i + 1`, not `i`, so `s.add` asks nothing of `i` directly, and
  // `i` stays a `number`. Refused as today.
  expectStaticTypeError('const s = new Set.<uint32>(); for (const i of 0..<3) s.add(i + 1);');
});

test('uses that disagree infer nothing', () => {
  expectStaticTypeError(
    'const s = new Set.<uint32>(); const u = new Set.<int8>(); for (const i of 0..<3) { s.add(i); u.add(i); }');
});

test('a use that asks for no numeric type leaves the binding a number', () => {
  expect(evaluated(L('let x: any = i;'))).toBe('number');
  expect(evaluated(L('let x: number = i;'))).toBe('number');
  expect(evaluated(L('const e = a[i];', 'const a: [3].<uint8> = [1, 2, 3];'))).toBe('number');
});

test('a declared number is still refused - only the loop binding is inferred', () => {
  // Both are refused with the same message without this; only the loop binding,
  // marked untyped by the literal in its head, changes.
  expectStaticTypeError('let n: number = 5; let x: uint8 = n;');
  expectStaticTypeError('const a: uint8 = 1; const n: number = 2; const r = a + n;');
});

test('the annotated form is unchanged, and wins', () => {
  expect(evaluated('let t = \'\'; for (const i: uint8 of 0..<3) { t = String(Reflect.typeOf(i)); } t;'))
    .toBe('uint.<8>');
});
