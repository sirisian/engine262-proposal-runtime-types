import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "hasInstance number paren",
    "function f(x:{[Symbol.hasInstance]:number}){({}) instanceof x;}"
  ],
  [
    "hasInstance number paren executed",
    "function f(x:{[Symbol.hasInstance]:number}){({}) instanceof x;} f({[Symbol.hasInstance]:1});"
  ],
  [
    "control: primitive lhs still hook",
    "function f(x:{[Symbol.hasInstance]:number}){1 instanceof x;}f({[Symbol.hasInstance]:1});"
  ],
  [
    "control: hook union bad",
    "function f(x:{[Symbol.hasInstance]:number|string}){({}) instanceof x;}f({[Symbol.hasInstance]:1});"
  ],
  [
    "edge: all-invalid unused",
    "function f(x:{[Symbol.hasInstance]:number|string}){({}) instanceof x;}"
  ],
  [
    "edge: inherited generic unused",
    "class B<T>{[Symbol.hasInstance]:T;}class C extends B.<number>{}function f(x:C){({}) instanceof x;}"
  ],
  [
    "edge: typed hook method contract unused",
    "function f(x:{[Symbol.hasInstance]:(v:number)=>boolean}){({}) instanceof x;}"
  ],
  [
    "edge: typed hook method contract executed",
    "function f(x:{[Symbol.hasInstance]:(v:number)=>boolean}){({}) instanceof x;}f({[Symbol.hasInstance](v:number):boolean{return true;}});"
  ],
  [
    "existing non-object target error",
    "function f(x:number){({}) instanceof x;}"
  ]
])('R33 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "control: any",
    "function f(x:any){({}) instanceof x;}f({[Symbol.hasInstance]:1});"
  ],
  [
    "control: legacy",
    "({}) instanceof {[Symbol.hasInstance]:1};"
  ]
])('R33 preserves runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "control: callable boolean",
    "function f(x:{[Symbol.hasInstance]:(v:any)=>boolean}){return ({}) instanceof x;}f({[Symbol.hasInstance](v){return true;}});"
  ],
  [
    "control: callable object result",
    "function f(x:{[Symbol.hasInstance]:(v:any)=>object}){return ({}) instanceof x;}f({[Symbol.hasInstance](v){return {};}});"
  ],
  [
    "control: optional good fallback",
    "function f(x:{[Symbol.hasInstance]?:number}){({}) instanceof x;}"
  ],
  [
    "control: optional runtime function fallback",
    "function f(x:any){({}) instanceof x;}f(function(){});"
  ],
  [
    "control: hook union good",
    "function f(x:{[Symbol.hasInstance]:number|((v:any)=>boolean)}){({}) instanceof x;}f({[Symbol.hasInstance](v){return true;}});"
  ],
  [
    "control: other symbol",
    "const s=Symbol();function f(x:{[s]:number}){({}) instanceof x;}"
  ],
  [
    "control: inherited method",
    "class B{[Symbol.hasInstance](v:any):boolean{return true;}}class C extends B{}function f(x:C){({}) instanceof x;}f(new C());"
  ],
  [
    "edge: open callable object",
    "function f(x:{[Symbol.hasInstance]:object}){({}) instanceof x;}f({[Symbol.hasInstance](){return true;}});"
  ],
  [
    "optional hook permits a callable fallback",
    "function f(x:{[Symbol.hasInstance]?:number}){({}) instanceof x;}let C=function(){};Object.setPrototypeOf(C,null);f(C);"
  ],
  [
    "a typed hook accepts the actual primitive argument",
    "function f(x:{[Symbol.hasInstance]:(v:number)=>boolean}){1 instanceof x;}f({[Symbol.hasInstance](v:number):boolean{return true;}});"
  ]
])('R33 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "typed return target",
    "function target():{[Symbol.hasInstance]:number}{return {[Symbol.hasInstance]:1};}function f(){({}) instanceof target();}"
  ],
  [
    "getter contract",
    "class C{get [Symbol.hasInstance]():number{throw 'must not execute';}}function f(x:C){1 instanceof x;}"
  ],
  [
    "all overload arguments invalid",
    "interface Hook{(x:number):boolean;(x:string):boolean;}function f(t:{[Symbol.hasInstance]:Hook}){({}) instanceof t;}"
  ]
])('R33 additional early boundary: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "argument union runtime alternative",
    "function f(x:number|object,t:{[Symbol.hasInstance]:(v:number)=>boolean}){x instanceof t;}f({},{[Symbol.hasInstance](v:number):boolean{return true;}});"
  ]
])('R33 additional runtime boundary: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "argument union valid alternative",
    "function f(x:number|object,t:{[Symbol.hasInstance]:(v:number)=>boolean}){x instanceof t;}f(1,{[Symbol.hasInstance](v:number):boolean{return true;}});"
  ],
  [
    "overload accepting actual argument",
    "interface Hook{(x:number):boolean;(x:object):boolean;}function f(t:{[Symbol.hasInstance]:Hook}){({}) instanceof t;}"
  ]
])('R33 additional ok boundary: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  'class A{operator number(){return 1;}}function f(x:A,t:{[Symbol.hasInstance]:(v:number)=>boolean}){x instanceof t;}f(new A(),{[Symbol.hasInstance](v:number):boolean{return true;}});',
  'function f(t:{[Symbol.hasInstance]:(v:uint8)=>boolean}){1 instanceof t;}f({[Symbol.hasInstance](v:uint8):boolean{return true;}});',
  'function f(t:{[Symbol.hasInstance]:(v?:number)=>boolean}){undefined instanceof t;}f({[Symbol.hasInstance](v?:number):boolean{return true;}});',
])('implicit hook calls retain conversions and optional arguments: %s', (source) => {
  expect(ok(source)).toBe(true);
});
