import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A typed function that can complete without a `return` returns *undefined*,
 * and `sec-check-elision` requires the annotation to admit it.
 *
 * The refusal rows and the total-body rows are each other's inverse: an
 * analysis that answers a constant passes one set. Both must hold.
 */

// --- A. Must be REJECTED -----------------------------------------------------

test('a function that can fall off its end is refused', () => {
  expectThrown('function f(a: uint8): uint8 { if (a) { return a; } }');
  expectThrown('function f(): uint8 { }');
  expectThrown('function f(a: uint8): uint8 { try { return a; } catch (e) { } }');
});

test('the same hole in a method, an arrow block body, and a getter', () => {
  expectThrown('class C { m(a: uint8): uint8 { if (a) { return a; } } }');
  expectThrown('const g = (a: uint8): uint8 => { if (a) { return a; } };');
  expectThrown('class C { get v(): uint8 { if (false) { return (1 := uint8); } } }');
});

// --- B. Annotations that admit undefined -------------------------------------

test('an annotation that admits undefined is accepted', () => {
  expect(evaluated('function f(a: uint8): void { if (a) { return; } } String(1);')).toBe('1');
  expect(evaluated('function f(a: uint8): uint8 | undefined { if (a) { return a; } }'
    + ' String(f((0 := uint8)) === undefined);')).toBe('true');
  expect(evaluated('function f(a: uint8): any { if (a) { return a; } }'
    + ' String(f((0 := uint8)) === undefined);')).toBe('true');
});

// --- C. Total bodies the naive primitive gets wrong ---------------------------

test('a total body is accepted however it is written', () => {
  // `endsWithReturn` answers false for every one of these - it tests only
  // whether the LAST statement is a return. Reusing it would have rejected all
  // six, which is the central risk made concrete.
  const cases = [
    'if (a) { return a; } else { return (0 := uint8); }',
    'while (true) { return a; }',
    'throw new Error("x");',
    'try { return a; } finally { }',
    'switch (a) { default: return a; }',
    'try { return a; } catch (e) { return (0 := uint8); }',
  ];
  for (const body of cases) {
    expect(evaluated(`function f(a: uint8): uint8 { ${body} } String(1);`)).toBe('1');
  }
});

test('a switch decides only with a default that no clause escapes', () => {
  // Without a `default` an unmatched value falls through, so the statement
  // completes and the function is incomplete. This was the whole blast radius:
  // 236 of 423 corpus programs, every one of them a `switch`.
  expectThrown('function f(a: uint8): uint8 { switch (a) { case (1 := uint8): return a; } }');
  expectThrown('function f(a: uint8): uint8 { switch (a) { default: break; } }');
  expect(evaluated('function f(a: uint8): uint8 { switch (a) { case (1 := uint8): default: return a; } }'
    + ' String(1);')).toBe('1');
});

// --- D. Out of scope ---------------------------------------------------------

test('nothing is promised without a written return annotation', () => {
  // An inferred return type is not published, so it is not a promise the
  // function made and does not bind here.
  expect(evaluated('function f(a: uint8) { if (a) { return a; } }'
    + ' String(f((0 := uint8)) === undefined);')).toBe('true');
  expect(evaluated('function f(a) { if (a) { return a; } } String(f(0) === undefined);')).toBe('true');
});

test('a concise arrow body cannot fall off', () => {
  expect(evaluated('const g = (a: uint8): uint8 => a; String(g((1 := uint8)));')).toBe('1');
});

// --- E. The explicit boundary still works ------------------------------------

test('explicit returns are still checked', () => {
  expectThrown('function f(): uint8 { throw new Error(); } f();');
  expectThrown('function f(): uint8 { return "nope"; } f();');
  expectThrown('function f(): uint8 { return (300 := uint16); } f();');
});
