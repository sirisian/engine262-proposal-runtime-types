import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  [
    "new arrow union identical",
    "const g=(x:uint8)=>x;const h=(x:uint8)=>x;function f(b:boolean){const c=b?g:h;new c(1);}"
  ],
  [
    "new arrow conditional",
    "const g=(x:uint8)=>x;const h=(x:uint8)=>x;function f(b:boolean){new (b?g:h)(1);}"
  ],
  [
    "new arrow alias",
    "const g=(x:uint8)=>x;function f(){new g(1);}"
  ],
  [
    "new arrow union run",
    "const g=(x:uint8)=>x;const h=(x:string)=>x;function f(b:boolean){const c=b?g:h;new c(1);}f(true);"
  ],
  [
    "async alternatives",
    "const g=async(x:uint8)=>x;const h=async(x:uint8)=>x;function f(b:boolean){new(b?g:h)(1);}"
  ],
  [
    "generator alternatives",
    "function* g(x:uint8){}function* h(x:uint8){}function f(b:boolean){new(b?g:h)(1);}"
  ],
  [
    "nested immutable aliases",
    "const g=(x:uint8)=>x;const h=(x:uint8)=>x;function f(a:boolean,b:boolean){const c=a?g:h;const d=b?c:g;new d(1);}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "new normal conditional",
    "function g(x:uint8){}function h(x:uint8){}function f(b:boolean){const c=b?g:h;new c(1);}f(true);"
  ],
  [
    "new mixed compatible",
    "const g=(x:uint8):uint8=>x;function h(x:uint8):uint8{return x;}function f(b:boolean){const c=b?g:h;new c(1);}f(false);"
  ],
  [
    "new any control",
    "const g=(x:uint8)=>x;function f(c:any){new c(1);}"
  ],
  [
    "untyped alternative defers",
    "const g=(x:uint8)=>x;const h=(x)=>x;function f(b:boolean){new(b?g:h)(1);}"
  ],
  [
    "unknown alternative defers",
    "const g=(x:uint8)=>x;function f(b:boolean,h:any){new(b?g:h)(1);}"
  ],
  [
    "mutable selection defers",
    "const g=(x:uint8)=>x;function h(x:uint8){}function f(b:boolean){let c=b?g:g;c=h;new c(1);}f(true);"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});


test("conditional class call is rejected before evaluation", () => {
  expectStaticTypeError("class A{x:uint8;}class B{x:uint8;}function f(b:boolean){(b?A:B)();}");
});
