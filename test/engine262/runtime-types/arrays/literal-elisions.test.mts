import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

test.each([
  [
    "hole dynamic",
    "function f(){let a:[].<uint8>=[,1];}"
  ],
  [
    "hole return",
    "function f():[2].<uint8>{return [,1];}"
  ],
  [
    "hole argument",
    "function take(a:[2].<uint8>){}function f(){take([,1]);}"
  ],
  [
    "hole array control",
    "function f(){let a:[2].<uint8>=[undefined,1];}"
  ],
  [
    "hole tuple control",
    "function f(){let a:[uint8,uint8]=[undefined,1];}"
  ],
  [
    "array hole run",
    "let a:[2].<uint8>=[,1];String(a[0]);"
  ],
  [
    "tuple elision",
    "function f(){let t:[uint8,uint8]=[,1];}"
  ],
  [
    "tuple rest elision",
    "function f(){let t:[...[].<uint8>]=[,1];}"
  ],
  [
    "hole is supplied to default",
    "function f(){let t:[uint8=1]=[,];}"
  ],
  [
    "several holes",
    "function f(){let t:[3].<uint8>=[,,1];}"
  ],
  [
    "elision before spread",
    "function f(a:[].<uint8>){let t:[].<uint8>=[,...a];}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "hole valid",
    "let a:[2].<(uint8|undefined)>=[,1];String(a[0]===undefined);",
    "true"
  ],
  [
    "hole any control",
    "let a=[,1];String(a[0]===undefined);",
    "true"
  ],
  [
    "tuple admits undefined",
    "let t:[undefined,uint8]=[,1];String(t[0]===undefined);",
    "true"
  ],
  [
    "default fills absent tail",
    "let t:[uint8=1]=[];String(t[0]);",
    "1"
  ],
  [
    "array union admits holes",
    "let t:[].<(uint8|undefined)>=[,,1];String(t.length);",
    "3"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});
