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

// #sec-ranges: Boolean is ordered (#sec-ordered-element-types) but is not a
// range element type, so a range over Boolean endpoints is refused, and a
// participating Boolean endpoint statically: a range binds looser than the
// relational operators, so `x > 1..=x < 5` would otherwise be a range of two
// comparisons.
test('Boolean endpoints are refused, statically where they participate', () => {
  expect(observeScript("const v: boolean = true; match (v) { when false..=true: 'in'; default: 'out'; };").completion.Type).toBe('throw');
  expect((observeScript('function f(x: uint8) { return x > 1..=x < 5; } "ok";').diagnostic as { rule?: string } | undefined)?.rule).toBe('rt-range-value');
});

// #sec-ordered-element-types orders Strings by code unit, and #sec-ranges
// admits them: containment and matching, but no implicit iteration.
test('a String range pattern matches by code-unit containment', () => {
  expect(evaluated("const s: string = 'm'; match (s) { when 'a'..='z': 'in'; default: 'out'; };")).toBe('in');
  expect(evaluated("const s: string = 'M'; match (s) { when 'a'..='z': 'in'; default: 'out'; };")).toBe('out');
  expect(evaluated("const s: string = 'q'; String(s is 'a'..='z');")).toBe('true');
  expect(evaluated("String(('a'..='z').contains('m')) + String(('a'..<'m').contains('m')) + String(('a'..='z').contains(5));")).toBe('truefalsefalse');
  expect(evaluated("let r = 'none'; try { for (const c of 'a'..='c') { r = c; } } catch (e) { r = e.constructor.name; } r;")).toBe('TypeError');
  expect(evaluated("let r = 'none'; try { const q: any = 1; 'a'..=q; } catch (e) { r = e.constructor.name; } r;")).toBe('TypeError');
});

// #sec-matchrange applies to a range written in the pattern. A bare name bound
// to a range value is a constant compared by SameValue, since a range declares
// no custom matcher; its spelling as a type reference is evaluated as the
// member expression it spells.
test('a name bound to a range value is a constant pattern', () => {
  expect(evaluated("const r = 1..=9; const v: any = 5; match (v) { when r: 'in'; default: 'out'; };")).toBe('out');
  expect(evaluated("const r = 1..=9; const v: any = r; match (v) { when r: 'same'; default: 'other'; };")).toBe('same');
  expect(evaluated("const o = { r: 1..=9 }; const v: any = o.r; match (v) { when o.r: 'same'; default: 'other'; };")).toBe('same');
});
