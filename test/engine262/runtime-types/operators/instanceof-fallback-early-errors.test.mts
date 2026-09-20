import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "null fallback with object origin unused",
    "function f(){const target:{[Symbol.hasInstance]:null} = {[Symbol.hasInstance]:null};({}) instanceof target;}"
  ],
  [
    "null fallback with object origin executed",
    "function f(){const target:{[Symbol.hasInstance]:null} = {[Symbol.hasInstance]:null};({}) instanceof target;}f();"
  ],
  [
    "undefined fallback with object origin unused",
    "function f(){const target:{[Symbol.hasInstance]:undefined} = {[Symbol.hasInstance]:undefined};({}) instanceof target;}"
  ],
  [
    "undefined fallback with object origin executed",
    "function f(){const target:{[Symbol.hasInstance]:undefined} = {[Symbol.hasInstance]:undefined};({}) instanceof target;}f();"
  ],
  [
    "primitive left still fails unused",
    "function f(){const target:{[Symbol.hasInstance]:null} = {[Symbol.hasInstance]:null};1 instanceof target;}"
  ],
  [
    "primitive left still fails executed",
    "function f(){const target:{[Symbol.hasInstance]:null} = {[Symbol.hasInstance]:null};1 instanceof target;}f();"
  ],
  [
    "immutable alias of object origin unused",
    "function f(){const target:{[Symbol.hasInstance]:null} = {[Symbol.hasInstance]:null};const alias=target;({}) instanceof (alias);}"
  ],
  [
    "immutable alias of object origin executed",
    "function f(){const target:{[Symbol.hasInstance]:null} = {[Symbol.hasInstance]:null};const alias=target;({}) instanceof (alias);}f();"
  ],
  [
    "existing bad hook",
    "function f(x:{[Symbol.hasInstance]:number}){({}) instanceof x;}"
  ]
])('R42 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any runtime",
    "class C{get [Symbol.hasInstance]():null{return null;}} function f(x:any){({}) instanceof x;}f(new C());"
  ],
  [
    "legacy runtime",
    "({}) instanceof {[Symbol.hasInstance]:null};"
  ]
])('R42 retains runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "custom hook",
    "class C{[Symbol.hasInstance](x:any):boolean{return true;}}function f(x:C){return ({}) instanceof x;}f(new C());"
  ],
  [
    "open shape can be callable",
    "function B(){}Object.defineProperty(B,Symbol.hasInstance,{value:null});function f(x:{[Symbol.hasInstance]:null}){return ({}) instanceof x;}const dyn:any=B;f(dyn);"
  ],
  [
    "known nominal with viable custom hook",
    "class C{get [Symbol.hasInstance]():null|((x:any)=>boolean){return (x:any):boolean=>true;}}function f(x:C){({}) instanceof x;}f(new C());"
  ],
  [
    "nominal prototype can describe callable",
    "class C{get [Symbol.hasInstance]():null{return null;}}function B(){}Object.setPrototypeOf(B,C.prototype);const b:any=B;function f(x:C){({}) instanceof x;}f(b);"
  ],
  [
    "mutable binding replaced with callable",
    "const B:any=function(){};Object.defineProperty(B,Symbol.hasInstance,{value:null});function f(){let target:{[Symbol.hasInstance]:null}={[Symbol.hasInstance]:null};target=B;({}) instanceof target;}f();"
  ],
  [
    "unknown hook on object literal",
    "function f(){const target:{x:number}={x:1};({}) instanceof target;}"
  ]
])('R42 preserves valid behavior: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});


test.each([
  [
    "object chain",
    "const target:{[Symbol.hasInstance]:null}={[Symbol.hasInstance]:null};const a=target;const b=a;function f(){({}) instanceof b;}"
  ],
  [
    "non-reassigned let",
    "function f(){let target:{[Symbol.hasInstance]:null}={[Symbol.hasInstance]:null};({}) instanceof target;}"
  ]
])('R42 rejects a proved edge case: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any alias",
    "const target:{[Symbol.hasInstance]:null}={[Symbol.hasInstance]:null};const a:any=target;({}) instanceof a;"
  ]
])('R42 keeps unknown origins dynamic: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "structural parameter",
    "function f(target:{[Symbol.hasInstance]:null}){({}) instanceof target;}"
  ],
  [
    "factory origin",
    "function make():{[Symbol.hasInstance]:null}{return {[Symbol.hasInstance]:null};}function f(){const target=make();({}) instanceof target;}"
  ],
  [
    "missing hook declaration",
    "function f(){const target:{x:number}={x:1};({}) instanceof target;}"
  ],
  [
    "optional valid hook",
    "function f(){const target:{[Symbol.hasInstance]?:((x:any)=>boolean)}={[Symbol.hasInstance](x:any):boolean{return true;}};({}) instanceof target;}f();"
  ],
  [
    "alias shadow",
    "const target:{[Symbol.hasInstance]:null}={[Symbol.hasInstance]:null};function f(target:any){({}) instanceof target;}f(function(){});"
  ],
  [
    "callable custom Object result",
    "function f(){const target:{[Symbol.hasInstance]:(x:any)=>object}={[Symbol.hasInstance](x:any):object{return {};}};({}) instanceof target;}f();"
  ]
])('R42 accepts a viable edge case: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});
