import { test, expect } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

// #sec-matchrange matches a range pattern by containment, and
// #sec-narrowing-flow orders `bigint` without limits and an enum by its
// enumerators' own order, so a range pattern ranges over each.

test('a bigint range pattern matches by containment', () => {
  expect(evaluated("const v: bigint = 5n; match (v) { when 1n..=9n: 'in'; default: 'out'; };")).toBe('in');
  expect(evaluated("const v: bigint = 50n; match (v) { when 1n..=9n: 'in'; default: 'out'; };")).toBe('out');
  expect(evaluated("const v: bigint = 5n; String(v is 1n..=9n);")).toBe('true');
});

test('a bigint literal is a literal pattern', () => {
  expect(evaluated("const v: bigint = 5n; match (v) { when 5n: 'five'; default: 'other'; };")).toBe('five');
});

test('an enum range pattern follows the enumerators\' order', () => {
  expect(evaluated("enum E { a, b, c, d } const v: E = E.c; match (v) { when E.b..=E.d: 'in'; default: 'out'; };")).toBe('in');
  expect(evaluated("enum E { a, b, c, d } const v: E = E.a; match (v) { when E.b..=E.d: 'in'; default: 'out'; };")).toBe('out');
});

test('Boolean endpoints are not ordered, so a range over them is refused', () => {
  expect(observeScript("const v: boolean = true; match (v) { when false..=true: 'in'; default: 'out'; };").completion.Type).toBe('throw');
});
