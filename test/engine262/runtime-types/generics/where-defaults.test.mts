import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a constant default its own declaration's clause rejects
 * can never be taken, and is refused where it is written. A decision for one
 * call, one return or one default says nothing about the next, so each is
 * still checked.
 */

const refused = (source: string, rule: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};

test('a default its own clause rejects is refused at the declaration', () => {
  refused('function f(i: uint32 = 5) where i > 10 { return i; }', 'rt-unreachable-default');
  refused('function g<N: uint32 = 0>() where N > 0 { return N; }', 'rt-unreachable-default');
  refused('class V<N: uint32 = 0> where N > 2 { }', 'rt-unreachable-default');
  refused('type A<N: uint32 = 0> = [N].<uint8> where N > 2;', 'rt-unreachable-default');
});

test('a default the clause admits, or one that reads another parameter, stands', () => {
  expect(evaluated('function f(i: uint32 = 15) where i > 10 { return i; } String(f());')).toBe('15');
  expect(evaluated('class V<N: uint32 = 3> where N > 2 { } String(new V() !== null);')).toBe('true');
  expect(evaluated('function f(a: uint8, b: uint8 = 5) where b > a { return b; } String(f(1));')).toBe('5');
});

test('a decided call, return or default leaves every other use checked', () => {
  refused('function f(i: uint32) where i > 10 { return i; } f(20); f(5);', 'rt-where-unsatisfied');
  refused('function f(i: uint32 = 15) where i > 10 { return i; } f(5);', 'rt-where-unsatisfied');
  expect(evaluated("function f(i: uint32) where i > 10 { return i; } f(20); const n: any = 5; let m = 'none'; try { f(n); } catch (e) { m = 'threw'; } m;")).toBe('threw');
  expect(evaluated("function f(x: uint8): uint8 where return > 10 { if (x > 3) { return 20; } return x; } let m = 'none'; try { f(1); } catch (e) { m = 'threw'; } m;")).toBe('threw');
});
