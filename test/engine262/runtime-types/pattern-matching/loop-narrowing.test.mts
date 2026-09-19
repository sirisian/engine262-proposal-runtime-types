import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Narrowing established before a loop was never re-widened when the body
 * invalidated it, so the second iteration was typed with a fact that had stopped
 * being true. The minimal case typechecked and failed at RUN TIME:
 *
 *   if (v !== null) { for (…) { n = v.x; v = null; } }   // Cannot convert null to object
 *
 * Ordinary invalidation always worked - the same two statements outside a loop
 * are refused - so what was missing is a rule at the back-edge, not a rule about
 * assignment. Every name a loop can reassign now loses its narrowing before the
 * body is walked.
 *
 * The body is walked ONCE, so the fact has to be dropped before the walk rather
 * than at the assignment: a read textually before the assignment is fine on the
 * first pass and stale on the second, and one walk cannot tell them apart. The
 * rule is therefore conservative by exactly that much.
 */
const H = 'class A { x: uint8 = 1; } let v: A | null = new A(); let n: uint8 = 0; ';

test('every loop form widens a narrowing its body can invalidate', () => {
  expectThrown(`${H}if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { n = v.x; v = null; } }`,
    'is not declared by every member');
  expectThrown(`${H}let k: uint8 = 0; if (v !== null) { while (k < 2) { k = k + 1; n = v.x; v = null; } }`,
    'is not declared by every member');
  expectThrown(`${H}let k: uint8 = 0; if (v !== null) { do { k = k + 1; n = v.x; v = null; } while (k < 2); }`,
    'is not declared by every member');
  expectThrown(`${H}const arr: [2].<uint8> = [1,2]; if (v !== null) { for (const e of arr) { n = v.x; v = null; } }`,
    'is not declared by every member');
  expectThrown(`${H}const o = { p: 1 }; if (v !== null) { for (const k in o) { n = v.x; v = null; } }`,
    'is not declared by every member');
});

test('an assignment nested in a block inside the body still counts', () => {
  expectThrown(`${H}if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { { n = v.x; } { v = null; } } }`,
    'is not declared by every member');
});

test('typeof narrowing widens the same way', () => {
  // Asserted through an assignment rather than a member read: `s.length` on a
  // `uint8` is refused with no loop and no narrowing at all, so a test built on
  // it cannot tell the leak from the ordinary refusal. Assigning the narrowed
  // binding to a `string` is refused unguarded and allowed when guarded, so the
  // control discriminates.
  expect(evaluated('let s: string | uint8 = "hi"; let t: string = ""; if (typeof s === "string") { t = s; } t;')).toBe('hi');
  expectThrown(`let s: string | uint8 = "hi"; let t: string = "";
    if (typeof s === "string") { for (let i: uint8 = 0; i < 2; i = i + 1) { t = s; s = (1 := uint8); } }`,
  'is not assignable to');
});

test('the idioms that were always correct still are', () => {
  // A loop that does not reassign, a narrowing re-established each pass, a
  // `const` base that cannot be reassigned, and a `while` narrowed by its own
  // test - none of these is touched by the widening.
  expect(evaluated(`${H}if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { n = v.x; } } String(n);`)).toBe('1');
  expect(evaluated(`${H}for (let i: uint8 = 0; i < 2; i = i + 1) { if (v !== null) { n = v.x; v = null; } } String(n);`)).toBe('1');
  expect(evaluated(`class A { x: uint8 = 1; } const v: A | null = new A(); let n: uint8 = 0;
    if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { n = v.x; } } String(n);`)).toBe('1');
  expect(evaluated(`${H}while (v !== null) { n = v.x; v = null; } String(n);`)).toBe('1');
});

test('straight-line invalidation outside a loop is unchanged', () => {
  expectThrown(`${H}if (v !== null) { v = null; n = v.x; }`, 'is not declared by every member');
});
