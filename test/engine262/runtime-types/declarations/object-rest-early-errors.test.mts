import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Check phase and effects as well as the outcome, including unused bodies.
test.each([
  [
    "R63-01: numeric rest annotation unused",
    "function f(o:any){let {...r:uint8}=o;}",
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
    "R63-02: numeric rest annotation executed",
    "function f(o:any){let {...r:uint8}=o;}f({});",
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
    "R63-03: symbol rest annotation unused",
    "function f(o:any){let {...r:symbol}=o;}",
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
    "R63-04: symbol rest annotation executed",
    "function f(o:any){let {...r:symbol}=o;}f({});",
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
    "R63-05: null rest annotation unused",
    "function f(o:any){let {...r:null}=o;}",
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
    "R63-06: null rest annotation executed",
    "function f(o:any){let {...r:null}=o;}f({});",
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
    "R63-07: callable rest annotation unused",
    "function f(o:any){let {...r:()=>void}=o;}",
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
    "R63-08: callable rest annotation executed",
    "function f(o:any){let {...r:()=>void}=o;}f({});",
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
    "R63-09: rest assignment boundary unused",
    "function f(o:any){let r:uint8=1;({...r}=o);}",
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
    "R63-10: rest assignment boundary executed",
    "function f(o:any){let r:uint8=1;({...r}=o);}f({});",
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
    "R63-11: rest parameter annotation",
    "function f({...r:uint8}:any){}",
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
    "R63-12: known structural source already checked",
    "function f(o:{x:uint8}){let {...r:uint8}=o;}",
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
    "R63-13: any rest annotation",
    "function f(o:any){let {...r:any}=o;}f({x:1});",
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
    "R63-14: object rest annotation",
    "function f(o:any){let {...r:object}=o;}f({});",
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
    "R63-15: structural rest annotation",
    "function f(o:any){let {...r:{x:uint8}}=o;}f({x:1});",
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
    "R63-16: viable object union",
    "function f(o:any){let {...r:uint8|object}=o;}f({});",
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
    "R63-17: runtime source eligibility",
    "function f(o:any){let {...r:object}=o;}f(null);",
    {
      "completion": "throw",
      "kind": "TypeError",
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R63-18: copy executes getter",
    "function f(o:any){let {...r:{x:uint8}}=o;}f({get x(){globalThis.hookRan=true;return 1;}});",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "true",
      "imports": []
    }
  ],
  [
    "R63-19: unchecked body does not execute getter",
    "function f(o:any){let {...r:{x:uint8}}=o;}const o={get x(){globalThis.hookRan=true;return 1;}};",
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
    "R63-20: primitive source still boxes",
    "function f(o:any){let {...r:object}=o;}f(\"abc\");",
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
    "R13-extra-44: function f<T extends uint8>(o:any){let {...r:T}=o;}",
    "function f<T extends uint8>(o:any){let {...r:T}=o;}",
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
    "R13-extra-45: function f<T>(o:any){let {...r:T}=o;}f.<object>({});",
    "function f<T>(o:any){let {...r:T}=o;}f.<object>({});",
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
    "R13-extra-46: function f(o:any){let {...r:uint8|string}=o;}",
    "function f(o:any){let {...r:uint8|string}=o;}",
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
    "R13-extra-47: function f(o:any){let {...r:{x:uint8}}=o;globalThis.settled=String(r.x);}f({x:1});",
    "function f(o:any){let {...r:{x:uint8}}=o;globalThis.settled=String(r.x);}f({x:1});",
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
    "R13-extra-51: function f(o:{x:uint8}){let {...r:{x?:string}}=o;}f(Object.create({x:uint8(1)}));",
    "function f(o:{x:uint8}){let {...r:{x?:string}}=o;}f(Object.create({x:uint8(1)}));",
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
    "R13-extra-52: function f(o:{x:uint8}){let {...r:{x?:string}}=o;}const o={};Object.defineProperty(o,\"x\",{value:uint8(1),enumerable:false});f(o);",
    "function f(o:{x:uint8}){let {...r:{x?:string}}=o;}const o={};Object.defineProperty(o,\"x\",{value:uint8(1),enumerable:false});f(o);",
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
    "R13-extra-53: function f(o:any,k:string){let {[k]:removed,...r:{x?:string}}=o;}f({x:1},\"x\");",
    "function f(o:any,k:string){let {[k]:removed,...r:{x?:string}}=o;}f({x:1},\"x\");",
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
    "R13-extra-54: function f(){let {...r:{x:string}}={x:uint8(1)};}",
    "function f(){let {...r:{x:string}}={x:uint8(1)};}",
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
