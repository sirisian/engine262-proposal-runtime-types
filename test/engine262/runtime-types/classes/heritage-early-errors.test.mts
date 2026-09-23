import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "primitive heritage unused",
    "function unused(Base:uint8){class C extends Base{}}"
  ],
  [
    "primitive heritage executed",
    "function unused(Base:uint8){class C extends Base{}} unused(uint8(1));"
  ],
  [
    "arrow heritage unused",
    "function unused(){const Base=(x:uint8):uint8=>x;class C extends Base{}}"
  ],
  [
    "arrow heritage executed",
    "function unused(){const Base=(x:uint8):uint8=>x;class C extends Base{}} unused();"
  ],
  [
    "primitive union heritage unused",
    "function unused(Base:uint8|string){class C extends Base{}}"
  ],
  [
    "primitive union heritage executed",
    "function unused(Base:uint8|string){class C extends Base{}} unused(uint8(1));"
  ],
  [
    "new already refuses",
    "function unused(){const Base=(x:uint8):uint8=>x;new Base(uint8(1));}"
  ]
])('R29 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "dynamic failure",
    "function unused(Base:any){class C extends Base{v:uint8=1;}}unused(1);"
  ],
  [
    "legacy failure",
    "function unused(){const Base=()=>1;class C extends Base{}}unused();"
  ]
])('R29 retains runtime failure: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "ordinary constructor",
    "function unused(){function Base(){} class C extends Base{v:uint8=1;}new C();}unused();"
  ],
  [
    "null",
    "function unused(){class C extends null{v:uint8;}}unused();"
  ],
  [
    "nullable union",
    "function unused(Base:null|uint8){class C extends Base{}}unused(null);"
  ],
  [
    "dynamic constructor",
    "function unused(Base:any){class C extends Base{v:uint8=1;}}unused(class{});"
  ],
  [
    "replaced origin",
    "function unused(){let Base=(x:uint8):uint8=>x;Base=function(x:uint8):uint8{return x;};class C extends Base{}}unused();"
  ]
])('R29 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "class expression",
    "function f(B:boolean){const C=class extends B{};}"
  ],
  [
    "typed generator",
    "function* B():uint8{yield 1;}class C extends B{}"
  ],
  [
    "typed async",
    "async function B():Promise.<number,never>{return 1;}class C extends B{}"
  ],
  [
    "immutable alias",
    "const B=(x:uint8)=>x;const Alias=B;class C extends (Alias){}"
  ]
])('R29 boundary control (early): %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "class self TDZ unused",
    "const B=(x:uint8)=>x;function f(){class B extends B{}}"
  ],
  [
    "parameter shadow",
    "const B=(x:uint8)=>x;function f(B){class C extends B{}}f(function(){});"
  ],
  [
    "generic value shadow",
    "const B=(x:uint8)=>x;class C<B: any> extends B{}"
  ],
  [
    "generic base",
    "class B<T: type>{}class C<T: type> extends B.<T>{}new C.<uint8>();"
  ],
  [
    "captured write invalidates",
    "let B=(x:uint8)=>x;function replace(){B=function(){};}replace();class C extends B{}"
  ],
  [
    "eval invalidates",
    "let B=(x:uint8)=>x;eval(\"B = function(){};\");class C extends B{}"
  ],
  [
    "function type annotation",
    "const B:(x:uint8)=>uint8=function(x:uint8):uint8{return x;};class C extends B{}"
  ]
])('R29 boundary control (ok): %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "class self TDZ executed",
    "const B=(x:uint8)=>x;function f(){class B extends B{}}f();"
  ]
])('R29 boundary control (ReferenceError): %s', (_name, source) => {
  expectThrownKind(source, 'ReferenceError');
});
