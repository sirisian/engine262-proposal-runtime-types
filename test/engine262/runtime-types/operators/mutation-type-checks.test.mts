import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each(['x++', '++x', '(x)++', '++(x)'])('%s invalidates the old narrowing', (update) => {
  expect(ok(`function f(x: 1 | 2) { if (x === 1) { ${update}; if (x === 2) {} } }`)).toBe(true);
  expectStaticTypeError(`function f(x: 1 | 2) { if (x === 1) { ${update}; let a: 1 = x; } }`);
  expect(evaluated(`function f(x: 1 | 2) { if (x === 1) { ${update}; return String(x); } } f(1);`)).toBe('2');
});

test.each(['x--', '--x'])('%s invalidates a narrowing in the opposite direction', (update) => {
  expect(ok(`function f(x: 1 | 2) { if (x === 2) { ${update}; if (x === 1) {} } }`)).toBe(true);
  expectStaticTypeError(`function f(x: 1 | 2) { if (x === 2) { ${update}; let a: 2 = x; } }`);
});

test.each(['/=', '%='])('integer %s rejects a literal zero divisor before evaluation', (operator) => {
  expectStaticTypeError(`function f() { let n: uint8 = 1; n ${operator} 0; }`);
  expectStaticTypeError(`class C { n: uint8 = 1; } function f(c: C) { c.n ${operator} 0; }`);
  expect(ok(`function f() { let n: uint8 = 1; n ${operator} 1; } f();`)).toBe(true);
  expect(ok(`class C { operator${operator}(n: uint8): C { return this; } } const c: C = new C(); c ${operator} 0;`)).toBe(true);
  expect(ok(`function f(n: bigint) { n ${operator} 0n; }`)).toBe(true);
});

test.each(['/=', '%='])('integer %s checks the referent of a call target', (operator) => {
  for (const target of ['loc()', '(loc())']) {
    expectStaticTypeError(`let n: uint8 = 4; function loc(): ref uint8 { return ref n; } function unused() { ${target} ${operator} 0; }`);
    expectStaticTypeError(`let n: uint8 = 4; function loc(): ref uint8 { return ref n; } ${target} ${operator} 0;`);
    expect(evaluated(`let n: uint8 = 4; function loc(): ref uint8 { return ref n; } ${target} ${operator} 3; String(n);`)).toBe('1');
  }
  expect(ok(`function unused(loc: any) { loc() ${operator} 0; }`)).toBe(true);
  expect(ok(`function unused(loc: () => ref bigint) { loc() ${operator} 0n; }`)).toBe(true);
});
