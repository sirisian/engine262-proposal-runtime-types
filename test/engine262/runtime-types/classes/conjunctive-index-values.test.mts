import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-object-types

test.each([
  [
    "all matching literal index signatures apply",
    "function f(){let o:{[a:string]:uint8;[b:string]:string}={x:1};}"
  ],
  [
    "one property cannot have two numeric representations",
    "let o:{[a:string]:uint8;[b:string]:uint16}={x:1};"
  ],
  [
    "nested property obeys all domains",
    "function unused(){let o:{v:{[a:string]:uint8;[b:string]:string}}={v:{x:1}};}"
  ],
  [
    "argument obeys all domains",
    "function f(x:{[a:string]:uint8;[b:string]:string}):void{} function unused(){f({x:1});}"
  ],
  [
    "return obeys all domains",
    "function f():{[a:string]:uint8;[b:string]:string}{return {x:1};}"
  ]
])('%s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "empty object has no residual properties",
    "let o:{[a:string]:uint8;[b:string]:string}={};"
  ],
  [
    "compatible overlaps adopt one representation",
    "let o:{[a:string]:uint8|string;[b:string]:uint8}={x:1};"
  ],
  [
    "identical domains and values",
    "let o:{[a:string]:uint8;[b:string]:uint8}={x:1};"
  ],
  [
    "named property keeps precedence",
    "let o:{x:uint8;[a:string]:uint8;[b:string]:string}={x:1};"
  ],
  [
    "unknown property remains dynamic",
    "function f(v:any){let o:{[a:string]:uint8;[b:string]:string}={x:v};}"
  ]
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});


test.each([
  ['shorthand', 'function unused(){const x:uint8=1;let o:{[a:string]:uint8;[b:string]:string}={x};}'],
  ['established spread', 'function unused(){const source:{x:uint8}={x:1};let o:{[a:string]:uint8;[b:string]:string}={...source};}'],
])('%s retains every index obligation', (_name, source) => {
  expectStaticTypeError(source);
});

test('compatible established spread keeps its value representation', () => {
  expect(ok('const source:{x:uint8}={x:1};let o:{[a:string]:uint8;[b:string]:uint8|string}={...source};')).toBe(true);
});
