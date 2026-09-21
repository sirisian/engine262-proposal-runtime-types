import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Check phase and effects as well as the outcome, including unused bodies.
test.each([
  [
    "R65-01: array length contribution unused",
    "function f(a:[].<uint8>){const {length:n:boolean}=a;}",
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
    "R65-02: array length contribution executed",
    "function f(a:[].<uint8>){const {length:n:boolean}=a;}f([1]);",
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
    "R65-03: fixed array index contribution unused",
    "function f(a:[2].<uint8>){const {0:n:boolean}=a;}",
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
    "R65-04: fixed array index contribution executed",
    "function f(a:[2].<uint8>){const {0:n:boolean}=a;}f([1,2]);",
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
    "R65-05: tuple position contribution unused",
    "function f(a:[uint8,string]){const {1:n:boolean}=a;}",
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
    "R65-06: tuple position contribution executed",
    "function f(a:[uint8,string]){const {1:n:boolean}=a;}f([1,\"x\"]);",
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
    "R65-07: assignment pattern unused",
    "function f(a:[].<uint8>){let n:boolean=false;({length:n}=a);}",
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
    "R65-08: assignment pattern executed",
    "function f(a:[].<uint8>){let n:boolean=false;({length:n}=a);}f([1]);",
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
    "R65-09: inferred const contribution unused",
    "function f(a:[].<uint8>){const {length}=a;length();}",
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
    "R65-10: inferred const contribution executed",
    "function f(a:[].<uint8>){const {length}=a;length();}f([1]);",
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
    "R65-11: known computed key",
    "function f(a:[].<uint8>){const {[\"length\"]:n:boolean}=a;}",
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
    "R65-12: common array tuple key",
    "function f(a:[].<uint8>|[uint8]){const {length:n:boolean}=a;}",
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
    "R65-13: default does not hide present property",
    "function f(a:[].<uint8>){const {length:n:boolean=false}=a;}f([1]);",
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
    "R65-14: direct length already checked",
    "function f(a:[].<uint8>){let n:boolean=a.length;}",
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
    "R65-15: direct array index already checked",
    "function f(a:[2].<uint8>){let n:boolean=a[0];}",
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
    "R65-16: direct tuple index already checked",
    "function f(a:[uint8,string]){let n:boolean=a[1];}",
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
    "R65-17: valid tuple position",
    "function f(a:[uint8,string]){const {1:n:string}=a;}f([1,\"x\"]);",
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
    "R65-18: valid array length",
    "function f(a:[].<uint8>){const {length:n:uint64}=a;}f([1]);",
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
    "R65-19: unknown source remains dynamic",
    "function f(a:any){const {length:n:boolean}=a;}f({length:true});",
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
    "R65-20: let gets no new storage annotation",
    "function f(a:[].<uint8>){let {length}=a;length=true;}f([1]);",
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
    "R65-21: unknown named property",
    "function f(a:[].<uint8>){const {other:n:boolean}=a;}",
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
    "R13-extra-35: function f(a:[uint8]){const {length:n:number}=a;globalThis.settled=String(n);}f([1]);",
    "function f(a:[uint8]){const {length:n:number}=a;globalThis.settled=String(n);}f([1]);",
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
    "R13-extra-36: function f(){const {length:n:number}=[1,2];globalThis.settled=String(n);}f();",
    "function f(){const {length:n:number}=[1,2];globalThis.settled=String(n);}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "2",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-37: function f(){const {0:n:uint8}=[1];globalThis.settled=String(n);}f();",
    "function f(){const {0:n:uint8}=[1];globalThis.settled=String(n);}f();",
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
    "R13-extra-38: function f(a:[uint8,...[].<string>]){const {1:n:string}=a;}f([1,\"s\"]);",
    "function f(a:[uint8,...[].<string>]){const {1:n:string}=a;}f([1,\"s\"]);",
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
    "R13-extra-39: function f(a:[2].<uint8>){const {[\"0\"]:n:boolean}=a;}",
    "function f(a:[2].<uint8>){const {[\"0\"]:n:boolean}=a;}",
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
    "R13-extra-40: function f({0:n}:[2].<uint8>){n();}",
    "function f({0:n}:[2].<uint8>){n();}",
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
    "R13-extra-41: function f(a:[].<uint8>){const {\"-1\":n:undefined}=a;}f([1]);",
    "function f(a:[].<uint8>){const {\"-1\":n:undefined}=a;}f([1]);",
    {
      "completion": "throw",
      "kind": "RangeError",
      "bodyRan": "true",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R13-extra-42: function f(a:[uint8,...[].<string>]){const {\"4294967295\":n:undefined}=a;}f([1,\"s\"]);",
    "function f(a:[uint8,...[].<string>]){const {\"4294967295\":n:undefined}=a;}f([1,\"s\"]);",
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
    "R13-extra-43: function f(a:[].<uint8>){const {\"18446744073709551616\":n:undefined}=a;}f([1]);",
    "function f(a:[].<uint8>){const {\"18446744073709551616\":n:undefined}=a;}f([1]);",
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
    "R13-extra-59: function f(a:[2].<uint8>){a[Symbol.iterator]=function*(){yield \"s\";};const {0:n:uint8}=a;globalThis.settled=String(n);}f([1,2]);",
    "function f(a:[2].<uint8>){a[Symbol.iterator]=function*(){yield \"s\";};const {0:n:uint8}=a;globalThis.settled=String(n);}f([1,2]);",
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
    "R13-extra-60: function f(){let a:[2].<uint8>=[1,2];a[Symbol.iterator]=function*(){yield \"s\";};const [n:string]=a;globalThis.settled=n;}f();",
    "function f(){let a:[2].<uint8>=[1,2];a[Symbol.iterator]=function*(){yield \"s\";};const [n:string]=a;globalThis.settled=n;}f();",
    {
      "completion": "normal",
      "kind": null,
      "bodyRan": "true",
      "settled": "s",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
