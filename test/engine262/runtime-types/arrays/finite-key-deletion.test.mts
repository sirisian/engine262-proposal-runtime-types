import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  [
    "delete finite array",
    "function f(o:[2].<uint8>, k:0|1){delete o[k];}"
  ],
  [
    "delete finite object",
    "function f(o:{a:uint8,b:uint8}, k:'a'|'b'){delete o[k];}"
  ],
  [
    "delete finite tuple",
    "function f(t:[uint8,uint8],k:0|1){delete t[k];}"
  ],
  [
    "delete finite optional",
    "function f(t:[uint8,uint8]|null,k:0|1){delete t?.[k];}"
  ],
  [
    "delete single",
    "function f(o:{a:uint8}){delete o.a;}"
  ],
  [
    "delete finite run",
    "function f(o:[2].<uint8>, k:0|1){delete o[k];}let a:[2].<uint8>=[1,2];f(a,0);"
  ],
  [
    "union receiver and keys",
    "function f(a:[2].<uint8>|[3].<uint8>,k:0|1){delete a[k];}"
  ],
  [
    "string index keys",
    "function f(a:[2].<uint8>,k:'0'|'1'){delete a[k];}"
  ],
  [
    "dynamic array keys",
    "function f(a:[].<uint8>,k:0|12){delete a[k];}"
  ],
  [
    "aliased key type",
    "type K='x'|'y';function f(a:{x:uint8,y:uint8},k:K){delete a[k];}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "delete finite mixed",
    "function f(a:[1].<uint8>,k:0|5){delete a[k];}"
  ],
  [
    "delete dynamic control",
    "function f(a:any,k:0|1){delete a[k];}"
  ],
  [
    "tuple nonposition alternative",
    "function f(a:[uint8],k:0|5){delete a[k];}"
  ],
  [
    "all nonpositions",
    "function f(a:[1].<uint8>,k:5|6){return delete a[k];}"
  ],
  [
    "unknown key",
    "function f(a:[2].<uint8>,k:number){delete a[k];}"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "nullable short circuit",
    "function f(a:[2].<uint8>|null,k:0|5){return delete a?.[k];}String(f(null,0));",
    "true"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});

test("delete symbol keys is rejected before evaluation", () => {
  expectStaticTypeError("function f(o:{[Symbol.iterator]:uint8,[Symbol.dispose]:uint8},b:boolean){delete o[b?Symbol.iterator:Symbol.dispose];}");
});
