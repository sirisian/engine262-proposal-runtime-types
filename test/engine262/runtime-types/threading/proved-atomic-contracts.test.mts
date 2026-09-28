import { expect, test } from 'vitest';
import { evaluatedSequence, expectStaticTypeError, ok } from '../harness.mts';

// #sec-atomics-typed-operations

test.each([
  [
    "integer atomic operation requires integer storage",
    "let n: float64 = 1; Atomics.and(ref n, 1);"
  ],
  [
    "atomics operand",
    "let n: uint8 = 1; Atomics.store(ref n, \"x\");"
  ],
  [
    "atomics no ref",
    "let n: uint8 = 1; Atomics.add(n, 1);"
  ],
  [
    "atomics float wait",
    "let n:float64=1; Atomics.waitAsync(ref n,0);"
  ],
  [
    "atomics property invalid",
    "const o={(n:float64):1}; Atomics.and(o,\"n\",1);"
  ],
  [
    "atomic arithmetic refuses nonnumeric operand",
    "let n:uint8=1;Atomics.add(ref n,\"s\");"
  ]
])('%s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "atomics and ok",
    "let n:uint8=1; Atomics.and(ref n,1);"
  ],
  [
    "atomics add float ok",
    "let n:float64=1; Atomics.add(ref n,1);"
  ],
  [
    "atomics replaced",
    "Atomics.and=(...xs)=>0; let n:float64=1; Atomics.and(ref n,1);"
  ],
  [
    "atomics shared ok",
    "let n:shared uint8=1; Atomics.and(ref n,1);"
  ],
  [
    "atomics property",
    "const o={(n:uint8):1}; Atomics.and(o,\"n\",1);"
  ],
  [
    "explicit atomic conversion can wrap",
    "let n:uint8=1;Atomics.store(ref n,300);"
  ],
  [
    "unmatched compareExchange does not convert replacement",
    "let n:uint8=1;Atomics.compareExchange(ref n,2,\"s\");"
  ],
  [
    "global replacement invalidates origin",
    "globalThis.Atomics={and(...xs){return 0;}};let n:float64=1;Atomics.and(ref n,1);"
  ]
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test('prior atomic method replacement stays dynamic', () => {
  expect(evaluatedSequence(['Atomics.and=function(){return 0;};', 'let n:float64=1;Atomics.and(ref n,1);"ok";'])).toBe('ok');
});
