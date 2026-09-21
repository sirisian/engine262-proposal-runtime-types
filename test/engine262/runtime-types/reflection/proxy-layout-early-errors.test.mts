import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

test.each([
  {
    "name": "R69-01: fixed array target unused",
    "source": "function f(a:[2].<uint8>){new Proxy(a,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-02: fixed array target executed",
    "source": "function f(a:[2].<uint8>){new Proxy(a,{});}f([1,2]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-03: dynamic extent typed array",
    "source": "function f(a:[].<uint8>){new Proxy(a,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-04: typed class target unused",
    "source": "class C{n:uint8=1;}function f(c:C){new Proxy(c,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-05: typed class target executed",
    "source": "class C{n:uint8=1;}new Proxy(new C(),{});",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-06: inherited layout",
    "source": "class A{n:uint8=1;}class B extends A{}function f(c:B){new Proxy(c,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-07: explicit proxy type does not remove layout",
    "source": "function f(a:[2].<uint8>){new Proxy.<object>(a,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-08: revocable uses same restriction",
    "source": "class C{n:uint8=1;}function f(c:C){Proxy.revocable(c,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-09: typed own property is allowed",
    "source": "const x={(n:uint8):1};new Proxy(x,{});",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-10: dynamic class is allowed",
    "source": "dynamic class C{n:uint8=1;}new Proxy(new C(),{});",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-11: ordinary array is allowed",
    "source": "new Proxy([1,2],{});",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-12: unknown target still runtime",
    "source": "function f(x:any){new Proxy(x,{});}const a:[2].<uint8>=[1,2];f(a);",
    "expected": {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-13: local constructor shadows Proxy",
    "source": "function f(Proxy:any,a:[2].<uint8>){new Proxy(a,{});}f(function(){},[1,2]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-14: global constructor replacement",
    "source": "Proxy=function(){};function f(a:[2].<uint8>){new Proxy(a,{});}f([1,2]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-15: revocable property replacement",
    "source": "Proxy.revocable=function(){return {};};function f(a:[2].<uint8>){Proxy.revocable(a,{});}f([1,2]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-16: structural typed view is not a layout proof",
    "source": "function f(x:{n:uint8}){new Proxy(x,{});}f({n:uint8(1)});",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-17: all layout alternatives",
    "source": "class C{n:uint8=1;}function f(a:[].<uint8>|C){new Proxy(a,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-18: ordinary Object alternative prevents proof",
    "source": "function f(a:[].<uint8>|object){new Proxy(a,{});}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-19: revocable executed",
    "source": "class C{n:uint8=1;}Proxy.revocable(new C(),{});",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-20: dynamic subclass still inherits layout",
    "source": "class A{n:uint8=1;}dynamic class B extends A{}function f(b:B){new Proxy(b,{});}f(new B());",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-21: reference class storage is still not proxyable",
    "source": "reference class C{n:uint8=1;}function f(c:C){new Proxy(c,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-22: reference class target executed",
    "source": "reference class C{n:uint8=1;}new Proxy(new C(),{});",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-23: native TypedArray construction unaffected",
    "source": "new Proxy(new Uint8Array(2),{});",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-01: const constructor alias",
    "source": "const P=Proxy;function f(a:[].<uint8>){new P(a,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-02: const specialized constructor alias",
    "source": "const P=Proxy.<object>;function f(a:[].<uint8>){new P(a,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-03: unknown alias",
    "source": "function f(P:any,a:[].<uint8>){new P(a,{});}f(function(){},[1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-04: direct eval mutation",
    "source": "eval(\"Proxy=function(){}\");function f(a:[].<uint8>){new Proxy(a,{});}f([1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-05: global property replacement",
    "source": "globalThis.Proxy=function(){};function f(a:[].<uint8>){new Proxy(a,{});}f([1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-06: aliased global replacement",
    "source": "const g=globalThis;g.Proxy=function(){};function f(a:[].<uint8>){new Proxy(a,{});}f([1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-07: unknown computed replacement",
    "source": "function replace(k:any){globalThis[k]=function(){};}replace(\"Proxy\");function f(a:[].<uint8>){new Proxy(a,{});}f([1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-08: reflective replacement",
    "source": "Object.defineProperty(globalThis,\"Proxy\",{value:function(){}});function f(a:[].<uint8>){new Proxy(a,{});}f([1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-09: getter remains runtime",
    "source": "Object.defineProperty(globalThis,\"Proxy\",{get(){globalThis.hookRan=true;return function(){};}});function f(a:[].<uint8>){new Proxy(a,{});}f([1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "true",
      "imports": []
    }
  },
  {
    "name": "R69-extra-10: spread mapping retains runtime",
    "source": "function f(a:[].<uint8>){new Proxy(...[a,{}]);}f([1]);",
    "expected": {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-11: reference class remains weakly holdable",
    "source": "reference class C{n:uint8=1;}new WeakRef(new C());",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-12: unknown call may replace global",
    "source": "function f(change:any,a:[].<uint8>){change();new Proxy(a,{});}f(()=>{Proxy=function(){};},[1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-13: coercion may replace global",
    "source": "function f(value:any,a:[].<uint8>){+value;new Proxy(a,{});}f({valueOf(){Proxy=function(){};return 1;}},[1]);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R69-extra-14: dynamic with lookup",
    "source": "with({Proxy:function(){}}){const a:[].<uint8>=[1];new Proxy(a,{});}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "SyntaxError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  }
])('$name', ({ source, expected }) => {
  expect(observeProtocol(source)).toMatchObject(expected);
});
