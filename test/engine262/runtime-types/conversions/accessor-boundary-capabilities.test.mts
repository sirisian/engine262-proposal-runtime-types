import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-isobjectsubtype, #sec-conversions
const getter = 'const o = { get n(): uint32 { return 1; } };';

test.each([
  'let x: { n:uint32 } = o;',
  'function f(x:{ n:uint32 }) {} f(o);',
  'function f(): { n:uint32 } { return o; }',
])('a getter-only source cannot grant writable access: %s', (boundary) => {
  expectStaticTypeError(`${getter} ${boundary}`);
});

test('an already typed getter satisfies a readonly interface without replacement', () => {
  expect(evaluated(`interface I { readonly n:uint32 } ${getter}`
    + ' function f(x:I) { return x; } const x = f(o);'
    + ' String(x === o) + ":" + String(x.n) + ":" + String(typeof Object.getOwnPropertyDescriptor(o, "n").set);')).toBe('true:1:undefined');
});

test('a getter with a matching setter retains writable compatibility', () => {
  expect(evaluated('interface I { n:uint32 } let stored:uint32 = 1;'
    + ' const o = { get n():uint32 { return stored; }, set n(v:uint32) { stored = v; } };'
    + ' function f(x:I) { x.n = 2; } f(o); String(stored);')).toBe('2');
});
