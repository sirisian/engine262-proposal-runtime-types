import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowfrom, #sec-where-clauses: a refinement admits exactly the values
 * of its base that satisfy its predicate, so an `is` test of a source of the
 * base against it settles neither half, and narrows the source to the
 * refinement where it passes.
 */

const NE = 'type NE = string where this.length > 0;';
const refused = (source: string, rule: string) => expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });

test('a test of the base against a refinement decides a branch', () => {
  expect(evaluated(`${NE} function f(s: string) { if (s is NE) { return 'y'; } return 'n'; } f('') + f('x');`)).toBe('ny');
  expect(evaluated(`${NE} function f(s: string | number) { if (s is NE) { return 'y'; } return 'n'; } f('') + f('x') + f(1);`)).toBe('nyn');
  expect(evaluated("type B10 = uint32 where this < 10; function h(u: uint32) { return (u is B10) && u < 5 ? 'a' : 'b'; } h((3 := uint32)) + h((15 := uint32));")).toBe('ab');
});

test('a passing test narrows the source to the refinement', () => {
  expect(evaluated(`${NE} function f(s: string) { if (s is NE) { const b: NE = s; return String(b.length); } return 'n'; } f('') + f('xy');`)).toBe('n2');
  expect(evaluated("type B10 = uint32 where this < 10; function h(u: uint32) { if (u is B10) { const b: B10 = u; return String(b); } return 'big'; } h((3 := uint32)) + h((15 := uint32));")).toBe('3big');
  expect(evaluated("type NE<T: type> = T where this.length > 0; function f(s: string) { if (s is NE.<string>) { const b: NE.<string> = s; return b; } return 'n'; } f('') + f('x');")).toBe('nx');
  expect(evaluated(`${NE} function f(s: string) { if (s is NE) { return 'y'; } else { const t: string = s; return 'n' + t; } } f('') + f('x');`)).toBe('ny');
});

test('a source sharing no value with the base still never succeeds', () => {
  refused(`${NE} function f(s: number) { if (s is NE) { return 'y'; } return 'n'; } f(1);`, 'rt-impossible-test');
});
