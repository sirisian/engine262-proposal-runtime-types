import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Reading a key that SOME arm of a union declares is refused, and the message
 * said only what was wrong: `"x" is not declared by every member of "A | null"`.
 * Accurate, and silent about the two spellings that work.
 *
 * The hint is SCOPED to this shape on purpose. The same operation also handles a
 * key NO arm declares, which is an ordinary read per `sec-typed-storage` -
 * "reading a property the type does not declare is unaffected" - and returns
 * *undefined* rather than refusing. Suggesting a guard there would send a
 * misspelling after a fix that cannot work, so the hint is attached only where
 * narrowing actually reaches the key.
 */
const A = 'class A { x: uint8 = 1; } let v: A | null = new A(); ';

test('the refusal names both fixes', () => {
  expectThrown(`${A}String(v.x);`, 'narrow the receiver first, or read it with');
  expectThrown(`${A}String(v.x);`, 'is not declared by every member of');
});

test('both suggested fixes work', () => {
  expect(evaluated(`${A}if (v !== null) { String(v.x); } else { 'no'; }`)).toBe('1');
  expect(evaluated(`${A}String(v?.x);`)).toBe('1');
});

test('a key no arm declares is still an ordinary read', () => {
  // Not refused, so not hinted: there is nothing to narrow to.
  expect(evaluated(`${A}String(v?.zz);`)).toBe('undefined');
});

test('unrelated diagnostics are untouched', () => {
  expectThrown('let k: uint8 = 300;', 'is not assignable to');
});
