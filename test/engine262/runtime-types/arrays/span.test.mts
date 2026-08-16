import { test, expect } from 'vitest';
import {
  evaluated, expectStaticTypeError, bool,
} from '../harness.mts';

/**
 * #sec-span-type: `Span.<T>` is a fixed-length WINDOW over a run of elements of
 * T that it does not own.
 *
 * The array types say what is known about an EXTENT - `[N].<T>` states one and
 * `[].<T>` states that it varies. Ownership is a separate question, and this is
 * the type that answers it, which is why it lives in a name rather than inside
 * the brackets: a bracket slot carrying both would have made `[].<T>` differ
 * from `[N].<T>` on one axis and from a window on another.
 *
 * The type was already latent in the design and had no name. An array view over
 * a buffer is a window, and an `SoA` column projection is a window; both had to
 * invent the concept locally and neither could say what it was returning.
 *
 * This file covers what has landed: the type, its coercions in both directions,
 * membership, and the receiver surface. The materialised window value and the
 * respelled view constructor are not here yet.
 */

// -- coercion: owned to window, never the reverse -----------------------------

test('an owned array coerces to a window', () => {
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [].<uint32> = [1, 2]; String(f(a));')).toBe('2');
  expect(evaluated('function f(p: Span.<uint32>) { return p.length; }'
    + ' let a: [4].<uint32> = [1, 2, 3, 4]; String(f(a));')).toBe('4');
});

test('a tuple coerces only when every position is the element type', () => {
  expect(evaluated('function f(p: Span.<uint8>) { return p.length; }'
    + ' let t: [uint8, uint8] = [1, 2]; String(f(t));')).toBe('2');
  // a mixed tuple is not a run of one type, so there is no window of it
  expectStaticTypeError('function f(p: Span.<uint8>) { return p.length; }'
    + ' let t: [uint8, uint16] = [1, 300]; f(t);');
});

test('a window does not coerce back to an owned array', () => {
  // Neither the storage nor the right to grow it is the window's to give.
  expectStaticTypeError('function f(p: [].<uint32>) { return p.length; }'
    + ' function g(s: Span.<uint32>) { return f(s); }');
  expectStaticTypeError('function f(p: [4].<uint32>) { return p.length; }'
    + ' function g(s: Span.<uint32>) { return f(s); }');
});

test('the element type must match', () => {
  expectStaticTypeError('function f(p: Span.<uint8>) { return p.length; }'
    + ' let a: [].<uint32> = [1, 2]; f(a);');
  // `Span.<any>` is admissible on the same ground `[].<any>` is: a store
  // through it is checked against the storage's own element type at run time.
  expect(evaluated('function f(p: Span.<any>) { return p.length; }'
    + ' let a: [].<uint8> = [1, 2]; String(f(a));')).toBe('2');
});

// -- the family --------------------------------------------------------------

test('a window is a member of the array and tuple family', () => {
  // Bare `[]` is the family bound, so a window has to satisfy it or the window
  // would be outside the family it is a view of.
  expect(evaluated('function f(p: []) { return p.length; }'
    + ' function g(s: Span.<uint32>) { return f(s); }'
    + ' let a: [].<uint32> = [1, 2]; String(g(a));')).toBe('2');
  expect(evaluated('function f<T extends []>(p: T) { return p.length; }'
    + ' function g(s: Span.<uint32>) { return f(s); }'
    + ' let a: [].<uint32> = [1, 2]; String(g(a));')).toBe('2');
});

// -- membership is structural, not a prototype chain --------------------------

test('membership asks what the value holds, not what it descends from', () => {
  // There is no `Span` global and no window prototype: a window is a way of
  // viewing storage rather than a class of object. So `is` asks the question
  // the coercion asks - is this a run of T - and every form that coerces
  // answers yes.
  expect(bool('let a: [].<uint32> = [1, 2]; String(a is Span.<uint32>);')).toBe(true);
  expect(bool('let a: [4].<uint32> = [1, 2, 3, 4]; String(a is Span.<uint32>);')).toBe(true);
  // and an untyped array is not a run of uint32, so it is not one
  expect(bool('let a = [1, 2]; String(a is Span.<uint32>);')).toBe(false);
});

test('a view over a buffer is a window', () => {
  // The type the view clause always described and could not name.
  expect(evaluated('const b = new ArrayBuffer(4);'
    + ' function f(p: Span.<uint8>) { return p.length; } String(f([].<uint8>(b)));')).toBe('4');
});

// -- the receiver surface -----------------------------------------------------

test('an element read through a window has the element type', () => {
  // Without this the receiver fell through to ~any~, so the type existed and
  // constrained nothing - worse than not having it.
  expectStaticTypeError('function f(p: Span.<uint32>) { let s: string = p[0]; return s; }');
  expect(evaluated('function f(p: Span.<uint32>) { let n: uint32 = p[0]; return n; }'
    + ' let a: [].<uint32> = [5]; String(f(a));')).toBe('5');
});

test('length reads at the index type', () => {
  expect(evaluated('function f(p: Span.<uint32>) { let n: uint32 = p.length; return n; }'
    + ' let a: [].<uint32> = [1, 2]; String(f(a));')).toBe('2');
});

test('a window has no operation that grows, shrinks, or names an allocation', () => {
  // `capacity`, `reserve`, and `shrinkToFit` describe an allocation and a
  // window owns none. `push` and the rest change a length, and a window's
  // length is fixed.
  for (const member of ['capacity', 'reserve(1)', 'shrinkToFit()', 'push(1)', 'pop()', 'shift()', 'unshift(1)', 'splice(0, 1)']) {
    expectStaticTypeError(`function f(p: Span.<uint32>) { return p.${member}; }`);
  }
});

test('a window keeps the array reads', () => {
  expect(evaluated('function f(p: Span.<uint32>) { return p.indexOf((2 := uint32)); }'
    + ' let a: [].<uint32> = [1, 2, 3]; String(f(a));')).toBe('1');
  expect(evaluated('function f(p: Span.<uint32>) { return p.includes((2 := uint32)); }'
    + ' let a: [].<uint32> = [1, 2, 3]; String(f(a));')).toBe('true');
});

// -- the owned types are undisturbed ------------------------------------------

test('adding the window changes nothing about the array types', () => {
  expect(evaluated('let a: [].<uint32> = []; a.push((1 := uint32)); String(a.length);')).toBe('1');
  expect(evaluated('let a: [].<uint32> = []; a.reserve(64); String(a.capacity);')).toBe('64');
  expect(evaluated('let a: [4].<uint32> = [1, 2, 3, 4]; String(a.capacity);')).toBe('4');
  expect(evaluated('let a = [1, 2, 3]; String(a.length);')).toBe('3');
});
