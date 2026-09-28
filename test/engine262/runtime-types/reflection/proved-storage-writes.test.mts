import { expect, test } from 'vitest';
import { evaluatedSequence, expectStaticTypeError, ok } from '../harness.mts';

// #sec-proved-library-operations; #sec-the-boundary-check

test.each([
  [
    "assign preserves a typed own-data boundary",
    "Object.assign({(x:uint8):0},{x:\"s\"});"
  ],
  [
    "a later source cannot erase an earlier write failure",
    "Object.assign({(x:uint8):0},{x:\"s\"},{x:1});"
  ],
  [
    "fresh reflect define",
    "Object.defineProperty({(x:uint8):0},\"x\",{value:\"s\"});"
  ],
  [
    "fresh reflect set",
    "Reflect.set({(x:uint8):0},\"x\",\"s\");"
  ]
])('%s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "fresh reflect assign ok",
    "Object.assign({(x:uint8):0},{x:1});"
  ],
  [
    "fresh reflect assign replaced",
    "Object.assign=(a,b)=>a; Object.assign({(x:uint8):0},{x:\"s\"});"
  ],
  [
    "untyped extra own property is allowed",
    "Object.assign({(x:uint8):0},{y:\"s\"});"
  ],
  [
    "last literal source definition supplies the value",
    "Object.assign({(x:uint8):0},{x:\"s\",x:1});"
  ],
  [
    "a mutable source does not keep its initializer values",
    "const s={x:\"s\"};Reflect.set(s,\"x\",1);Object.assign({(x:uint8):0},s);"
  ],
  [
    "reflect with distinct receiver keeps its semantics",
    "const o={(x:uint8):0};Reflect.set(o,\"x\",\"s\",{});"
  ],
  [
    "global assign replacement stays dynamic",
    "globalThis.Object={assign(a,b){return a;}};Object.assign({(x:uint8):0},{x:\"s\"});"
  ]
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  ['prior assign replacement', 'Object.assign=function(a){return a;};', 'Object.assign({(x:uint8):0},{x:"s"});"ok";'],
  ['getter executes only at evaluation', 'globalThis.calls=0;Object.defineProperty(Object,"assign",{get(){calls++;return function(a){return a;};}});', 'Object.assign({(x:uint8):0},{x:"s"});String(calls);', '1'],
])('%s retains runtime effects', (_name, setup, source, result = 'ok') => {
  expect(evaluatedSequence([setup, source])).toBe(result);
});

test.each([
  ['assign', 'Object.assign({(x:uint8):0},{(x:any):"s"});'],
  ['descriptor', 'Object.defineProperty({(x:uint8):0},"x",{(value:any):"s"});'],
])('%s retains an explicit dynamic source boundary', (_name, source) => {
  expect(ok('try{' + source + '}catch{}')).toBe(true);
});
