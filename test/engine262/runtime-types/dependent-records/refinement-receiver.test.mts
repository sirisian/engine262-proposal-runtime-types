import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-where-clauses: a refinement predicate is evaluated with `this` bound to
 * the tested value itself, so a typed primitive keeps its type, and its
 * arithmetic, whatever the strictness of the surrounding code.
 */

test('typed arithmetic in a predicate keeps the value\'s type', () => {
  expect(evaluated('type W = uint8 where this + 1 > this; String((255 := uint8) is W) + String((3 := uint8) is W);')).toBe('falsetrue');
  expect(evaluated("'use strict'; type W = uint8 where this + 1 > this; String((255 := uint8) is W);")).toBe('false');
});
