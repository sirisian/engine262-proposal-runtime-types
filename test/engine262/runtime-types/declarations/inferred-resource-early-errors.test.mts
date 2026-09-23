import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Preserve the error phase as well as the outcome and observable effects.
test.each([
  [
    "R59-01: using-inferred",
    "function f(r:{[Symbol.dispose]:uint8}){using x=r;}f({[Symbol.dispose]:1});",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-02: using-inferred-args",
    "function f(r:{[Symbol.dispose]:(x:uint8)=>void}){using x=r;}f({[Symbol.dispose]:(x:uint8):void=>{}});",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-03: using-primitive-unused",
    "function f(n:uint8){using x=n;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-04: using-primitive-run",
    "function f(n:uint8){using x=n;}f(1);",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-05: using-number",
    "function f(n:number){using x=n;}f(1);",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-06: using-call-unused",
    "function make():{[Symbol.dispose]:uint8}{return {[Symbol.dispose]:1};}function f(){using x=make();}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-07: using-class-unused",
    "class Bad{[Symbol.dispose]:uint8=1;}function f(){using x=new Bad();}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-08: using-inherited-unused",
    "class B{[Symbol.dispose]:uint8=1;}class C extends B{}function f(c:C){using x=c;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-09: using-getter-unused",
    "class C{get [Symbol.dispose]():uint8{globalThis.hookRan=true;return 1;}}function f(c:C){using x=c;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-10: using-call-args-unused",
    "function f(c:{[Symbol.dispose]:(n:uint8)=>void}){using x=c;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-11: using-union-invalid",
    "function f(n:uint8|{[Symbol.dispose]:uint8}){using x=n;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-12: using-plain-js",
    "function f(n){using x=n;}f(1);",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R59-13: using-any",
    "function f(n:any){using x=n;}f(1);",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R59-14: using-explicit-any",
    "function f(n:{[Symbol.dispose]:uint8}){using x:any=n;}f({[Symbol.dispose]:1});",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R59-15: using-annotation-control",
    "function f(c:{[Symbol.dispose]:uint8}){using x:{[Symbol.dispose]:uint8}=c;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-16: using-good-call",
    "function f(c:{[Symbol.dispose]:()=>void}){using x=c;}f({[Symbol.dispose]:()=>{globalThis.hookRan=true;}});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "true"
    }
  ],
  [
    "R59-17: using-optional-arg",
    "function f(c:{[Symbol.dispose]:(n?:uint8)=>void}){using x=c;}f({[Symbol.dispose]:(n?:uint8):void=>{globalThis.hookRan=true;}});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "true"
    }
  ],
  [
    "R59-18: using-nullish",
    "function f(n:null|undefined){using x=n;}f(null);f(undefined);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R59-19: using-union-viable",
    "function f(n:uint8|null){using x=n;}f(null);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R59-20: using-open",
    "function f(n:object){using x=n;}f({[Symbol.dispose](){globalThis.hookRan=true;}});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "true"
    }
  ],
  [
    "R59-21: using-generic",
    "function f<T: type>(n:T){using x=n;}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R59-22: ignored disposer result remains ignored",
    "type Bad={then:(x:uint8)=>void};function f(c:{[Symbol.dispose]:()=>Bad}){using x=c;}f({[Symbol.dispose]:()=>({then:(x:uint8):void=>{}})});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R59-23: explicit broad annotation remains a boundary",
    "function f(c:{[Symbol.dispose]:uint8}){using x:object=c;}f({[Symbol.dispose]:1});",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError"
    }
  ],
  [
    "R59-E01: earlier typed binding in using list",
    "function f(n:uint8){using a:{[Symbol.dispose]:()=>void,bad:uint8}={ [Symbol.dispose](){}, get bad():uint8{return n;} }, b=a.bad;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-E02: unannotated binding gets no permanent type",
    "function f(n:{[Symbol.dispose]:()=>void}){using x=n;let y:string=x;}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R59-E03: explicit any earlier binding",
    "function f(n:{[Symbol.dispose]:uint8}){using a:any=n,b=a;}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R59-E04: specialized disposer",
    "class R<T: type>{[Symbol.dispose](x:T):void{}}function f(r:R.<uint8>){using x=r;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-E05: required reference disposer",
    "class R{[Symbol.dispose](ref x:uint8):void{}}function f(r:R){using x=r;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-E06: fixed rest disposer",
    "class R{[Symbol.dispose](...x:[1].<uint8>):void{}}function f(r:R){using x=r;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R59-E07: default disposer",
    "class R{[Symbol.dispose](x:uint8=1):void{globalThis.hookRan=true;}}{using x=new R();}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "hookRan": "true"
    }
  ],
  [
    "R59-E08: empty rest disposer",
    "class R{[Symbol.dispose](...x:[].<uint8>):void{globalThis.hookRan=true;}}{using x=new R();}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "hookRan": "true"
    }
  ],
  [
    "R59-E09: undefined accepting disposer",
    "class R{[Symbol.dispose](x:uint8|undefined):void{globalThis.hookRan=true;}}{using x=new R();}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "hookRan": "true"
    }
  ],
  [
    "R59-E10: viable disposer overload",
    "function f(r:{[Symbol.dispose]:{(n:uint8):void;():void}}){using x=r;}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R59-E11: disposal order and exactly once",
    "let log=\"\";class R{constructor(name:string){this.name=name;}name:string;[Symbol.dispose]():void{log+=this.name;}}function f(){using a=new R(\"a\"),b=new R(\"b\");log+=\"f\";}f();globalThis.settled=log;",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "fba"
    }
  ],
  [
    "R59-E12: generic getter disposer specialized",
    "class R<T: type>{get [Symbol.dispose]():T{throw 0;}}function f(r:R.<uint8>){using x=r;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
