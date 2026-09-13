import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

const LIMITED = 'function limited<N: uint32>(x: uint32): uint32 where N < 4 { return x; }';
for (const use of ['limited.<9>(1);', 'const f = limited.<9>;', 'limited.<N: 9>(1);']) {
  test(`a closed generic constraint rejects an unused specialization: ${use}`, () => {
    expectStaticTypeError(`${LIMITED} function unused() { ${use} }`);
  });
}

test('valid specializations retain function identity and execute', () => {
  expect(evaluated(`${LIMITED} const f = limited.<2>; String(f(3)) + ":" + String(f === limited.<N: 2>);`)).toBe('3:true');
});

test('constraints can combine multiple bound value parameters', () => {
  expectStaticTypeError('function f<N: uint32, M: uint32>(): void where N * 2 + M <= 8 {} function unused() { f.<3, 4>(); }');
  expect(evaluated('function f<N: uint32, M: uint32>(): uint8 where N * 2 + M <= 8 { return 1; } String(f.<2, 4>());')).toBe('1');
});

test('nested declarations and shadowed names select the actual generic signature', () => {
  expectStaticTypeError(`function unused() { ${LIMITED} limited.<9>(1); }`);
  expect(evaluated(`${LIMITED} { function limited<N: uint32>(x: uint32): uint32 where N < 20 { return x; } String(limited.<9>(1)); }`)).toBe('1');
});

test('open generic constraints remain specialization-time checks', () => {
  expect(evaluated(`${LIMITED} function call<N: uint32>(): uint32 { return limited.<N>(1); } String(call.<2>());`)).toBe('1');
  expectThrownKind(`${LIMITED} function call<N: uint32>(): uint32 { return limited.<N>(1); } call.<9>();`, 'TypeError');
});

test('a runtime closure is not executed by the checking pass', () => {
  expect(evaluated('let calls = 0; function predicate() { calls++; return true; } function f<N: uint32>(): void where predicate() {} function unused() { f.<1>(); } String(calls);')).toBe('0');
});

test('bound generic parameters shadow unrelated runtime bindings during checking', () => {
  expectStaticTypeError(`let N = 0; ${LIMITED} function unused() { limited.<9>(1); }`);
  expect(evaluated(`let N = 9; ${LIMITED} function unused() { limited.<2>(1); } "ok";`)).toBe('ok');
});

test('checking a generic constraint cannot write a runtime binding', () => {
  expect(evaluated('let N = 7; function f<N: uint32>(): void where (N = 0) === 0 {} function unused() { f.<1>(); } String(N);')).toBe('7');
});
