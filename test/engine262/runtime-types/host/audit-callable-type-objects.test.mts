import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

const literals = [
  'function(x: uint8): uint8 { return x; }',
  '(x: uint8): uint8 => x',
  'async function(x: uint8): Promise.<uint8, Error> { return x; }',
  'async (x: uint8): Promise.<uint8, Error> => x',
  'function*(x: uint8): uint8 { yield x; }',
  'async function*(x: uint8): uint8 { yield x; }',
];

test.each(literals)('a function literal exposes its callable contract: %s', (literal) => {
  expectStaticTypeError(`const f = ${literal}; function unused() { f("bad"); }`);
  expect(ok(`const f = ${literal}; function unused() { f(1); }`)).toBe(true);
});

test.each(['function(ref x: uint8): void {}', '(ref x: uint8): void => {}'])(
  'literal signatures preserve ref: %s', (literal) => {
    expectStaticTypeError(`const f = ${literal}; function unused() { let x: uint8 = 1; f(x); }`);
    expect(ok(`const f = ${literal}; let x: uint8 = 1; f(ref x);`)).toBe(true);
  },
);

test.each(['function(x?: uint8): void {}', '(x?: uint8): void => {}', 'function(x: uint8 = 1): void {}'])(
  'literal signatures preserve optionality: %s', (literal) => {
    expect(ok(`const f = ${literal}; f();`)).toBe(true);
  },
);

test.each(['U', 'V', '(U)', 'A.<uint8>', 'uint.<8>'])(
  'type-object calls check source and result: %s', (callee) => {
    const aliases = 'type U = uint8; type V = U; type A<T> = T;';
    expectStaticTypeError(`${aliases} function unused() { ${callee}("bad"); }`);
    expectStaticTypeError(`${aliases} function unused(): string { return ${callee}(1); }`);
    expect(evaluated(`${aliases} const n: uint16 = ${callee}(1); String(n);`)).toBe('1');
  },
);

test.each(['uint8', '(uint8)', 'U', 'A.<uint8>'])(
  'tryParse exposes its nullable result: %s', (receiver) => {
    const aliases = 'type U = uint8; type A<T> = T;';
    expectStaticTypeError(`${aliases} function unused(): boolean { return ${receiver}.tryParse("1"); }`);
    expectStaticTypeError(`${aliases} function unused(): uint8 { return ${receiver}.tryParse("1"); }`);
    expect(ok(`${aliases} const n: uint8 | null = ${receiver}.tryParse("1");`)).toBe(true);
    expect(evaluated(`${aliases} String(${receiver}.tryParse(5));`)).toBe('null');
  },
);

test('value bindings shadow builtin and alias type-object operations', () => {
  expect(ok('function f(uint8) { let s: string = uint8.parse("x"); }')).toBe(true);
  expect(ok('type U = uint8; function f(U) { let s: string = U.parse("x"); return U("x"); }')).toBe(true);
  expect(evaluated('type U = uint8; { const U = (x) => "ok"; String(U("bad")); }')).toBe('ok');
});


test('inferred resumable literals preserve the callable carrier and generator inputs', () => {
  expectStaticTypeError('const f = async (x: uint8) => x; function unused(): string { return f(1); }');
  expect(ok('const f: (x: uint8) => Generator.<uint8, string, boolean> = function*(x) { yield x; return "done"; };')).toBe(true);
  expect(ok('const f: (x: uint8) => AsyncGenerator.<uint8, string, boolean> = async function*(x) { yield x; return "done"; };')).toBe(true);
  expectStaticTypeError('const f = function*(x: uint8): Generator.<uint8, string, boolean> { yield x; return "done"; }; function unused() { f(1).next("bad"); }');
});
