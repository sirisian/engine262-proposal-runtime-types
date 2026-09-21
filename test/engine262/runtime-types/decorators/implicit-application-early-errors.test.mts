import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Check phase and effects as well as the outcome, including unused bodies.
test.each([
  [
    "R62-01: scalar context unused",
    "function d(c:uint8):void{}function f(){@d class C{}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-02: scalar context executed",
    "function d(c:uint8):void{}@d class C{}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-03: explicit argument plus scalar context unused",
    "function d(n:uint8,c:uint8):void{}function f(){@d(1) class C{}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-04: explicit argument plus scalar context executed",
    "function d(n:uint8,c:uint8):void{}@d(1) class C{}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-05: reference context unused",
    "function d(ref c:object):void{}function f(){@d class C{}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-06: reference context executed",
    "function d(ref c:object):void{}@d class C{}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-07: missing required prefix unused",
    "function d(n:uint8,c:Reflect.Class):void{}function f(){@d class C{}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-08: missing required prefix executed",
    "function d(n:uint8,c:Reflect.Class):void{}@d class C{}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-09: field context unused",
    "function d(c:uint8):void{}function f(){class C{@d x:uint8=1;}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-10: field context executed",
    "function d(c:uint8):void{}class C{@d x:uint8=1;}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-11: method context unused",
    "function d(c:uint8):void{}function f(){class C{@d m():void{}}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-12: method context executed",
    "function d(c:uint8):void{}class C{@d m():void{}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-13: written argument already checked",
    "function d(n:uint8,c:object):void{}function f(){@d(\"bad\") class C{}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-14: any context",
    "function d(c:any):void{}@d class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-15: object context and empty parentheses",
    "function d(c:object):void{}@d() class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-16: explicit argument and object context",
    "function d(n:uint8,c:object):void{}@d(1) class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-17: default before reflection context",
    "function d(n:uint8=1,c:Reflect.Class):void{globalThis.settled=String(n);}@d class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-18: context-only overload preferred",
    "function d(c:Reflect.Class):void{globalThis.settled=\"alone\";}function d(n:uint8=1,c:Reflect.Class):void{globalThis.settled=\"default\";}@d class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "alone",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-19: rest collects context",
    "function d(...xs:[].<any>):void{globalThis.settled=String(xs.length);}@d(1,2) class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "3",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R62-20: return is not a decorator factory",
    "function d(c:Reflect.Class):uint8{return 1;}@d class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});

// Adjacent controls and regressions found while implementing the recommendation.
test.each([
  [
    "R13-extra-22: function d(c:uint8):void{}function f(){@d function g(){}}",
    "function d(c:uint8):void{}function f(){@d function g(){}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-23: function d(c:uint8):void{}function f(){class C{m(@d x:uint8){}}}",
    "function d(c:uint8):void{}function f(){class C{m(@d x:uint8){}}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-24: function d(c:uint8):void{}function f(){class C{@d static x:uint8=1;}}",
    "function d(c:uint8):void{}function f(){class C{@d static x:uint8=1;}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-25: function d(c:uint8):void{}function f(){@d {}}",
    "function d(c:uint8):void{}function f(){@d {}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-26: function d(c:uint8):void{}function d(c:object):void{}@d class C{}",
    "function d(c:uint8):void{}function d(c:object):void{}@d class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-27: function d(c:object):void{}function d(c:uint8):void{}@d() class C{}",
    "function d(c:object):void{}function d(c:uint8):void{}@d() class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-28: function d(n:uint8=1,c:Reflect.Class):void{}function d(n:string=\"x\",c:Reflect.Class):void{}function f(){@d class C{}}",
    "function d(n:uint8=1,c:Reflect.Class):void{}function d(n:string=\"x\",c:Reflect.Class):void{}function f(){@d class C{}}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-29: function d(...xs:[].<uint8>):void{}function f(){@d class C{}}",
    "function d(...xs:[].<uint8>):void{}function f(){@d class C{}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-30: function d(n:uint8=1,c:Reflect.Class):void{}@d() class C{}",
    "function d(n:uint8=1,c:Reflect.Class):void{}@d() class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-31: function d(c:{kind:string}):void{}@d class C{}",
    "function d(c:{kind:string}):void{}@d class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-32: function f(d:((c:uint8)=>void)|((c:object)=>void)){@d class C{}}",
    "function f(d:((c:uint8)=>void)|((c:object)=>void)){@d class C{}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-33: function d(c:object):void{}const a=[];@d(...a) class C{}",
    "function d(c:object):void{}const a=[];@d(...a) class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-34: function d(c:Reflect.Class):void{globalThis.hookRan=true;}function f(){@d class C{}}",
    "function d(c:Reflect.Class):void{globalThis.hookRan=true;}function f(){@d class C{}}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-55: function d(c:uint8):void{}function f(d:any,@d n:uint8){}",
    "function d(c:uint8):void{}function f(d:any,@d n:uint8){}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-56: function d(c:object):void{}function f(d:uint8,@d n:uint8){}",
    "function d(c:object):void{}function f(d:uint8,@d n:uint8){}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-57: function d(c:uint8):void{}function f(){class C{m(): @d void{}}}",
    "function d(c:uint8):void{}function f(){class C{m(): @d void{}}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-58: function d(c:uint8):void{}function f(){class C{@d #x:uint8=1;}}",
    "function d(c:uint8):void{}function f(){class C{@d #x:uint8=1;}}",
    {
      "completion": "throw",
      "kind": "StaticTypeError",
      "bodyRan": "false",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});

test.each([
  [
    "union alternatives retain implicit context",
    "function f(d:((c:object)=>void)|((c:Reflect.Class)=>void)){@d() class C{}}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "unknown spread can be empty before context",
    "function d(c:object):void{}function f(xs:Iterable.<uint8>){@d(...xs) class C{}}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "fixed rest counts implicit context",
    "function d(...xs:[1].<object>):void{globalThis.settled=String(xs.length);}@d() class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "1",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "overload eliminates incompatible context without false tie",
    "function d(c:uint8):void{}function d(c:object):void{}@d() class C{}",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
