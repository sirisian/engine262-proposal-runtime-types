import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Preserve the error phase as well as the outcome and observable effects.
test.each([
  [
    "R56-01: private-read-unused",
    "class C {#x:uint8=1;f(o:uint8){return o.#x;}}",
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
    "R56-02: private-read-run",
    "class C {#x:uint8=1;f(o:uint8){return o.#x;}}new C().f(1);",
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
    "R56-03: private-write",
    "class C {#x:uint8=1;f(o:uint8){o.#x=2;}}new C().f(1);",
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
    "R56-04: private-call",
    "class C {#m():void{}f(o:uint8){o.#m();}}new C().f(1);",
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
    "R56-05: private-update",
    "class C{#x:uint8=1;f(o:uint8){o.#x++;}}",
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
    "R56-06: private-pattern",
    "class C{#x:uint8=1;f(o:uint8){[o.#x]=[1];}}",
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
    "R56-07: private-optional-scalar",
    "class C{#x:uint8=1;f(o:uint8){return o?.#x;}}",
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
    "R56-08: private-string",
    "class C{#x:uint8=1;f(o:string){return o.#x;}}",
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
    "R56-09: private-union",
    "class C{#x:uint8=1;f(o:uint8|string){return o.#x;}}",
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
    "R56-10: private-optional-null",
    "class C{#x:uint8=1;f(o:null){return o?.#x;}}new C().f(null);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R56-11: private-mixed",
    "class C{#x:uint8=1;f(o:C|uint8){return o.#x;}}let c=new C();c.f(c);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R56-12: private-brand-stamp",
    "class Base{constructor(o){return o;}}class C extends Base{#x:uint8=1;static read(o:object){return o.#x;}}const o={};new C(o);String(C.read(o));",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R56-13: private-in",
    "class C {#x:uint8=1;f(o:uint8){return #x in o;}}",
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
    "R56-14: private-borrow",
    "class C{#x:uint8=1;f(o:uint8){let ref x=o.#x;}}",
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
    "R56-15: ordinary primitive public read",
    "function f(s:string){return s.length;}f(\"abc\");",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R56-16: any private receiver keeps runtime check",
    "class C{#x:uint8=1;f(o:any){return o.#x;}}new C().f(1);",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError"
    }
  ],
  [
    "R56-17: untyped private receiver keeps runtime check",
    "class C{#x=1;f(o){return o.#x;}}new C().f(1);",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError"
    }
  ],
  [
    "R56-18: valid private owner",
    "class C{#x:uint8=1;f(o:C){return o.#x;}}let c=new C();c.f(c);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R56-19: optional nullish union has an invalid selected access",
    "class C{#x:uint8=1;f(o:uint8|null){return o?.#x;}}new C().f(null);",
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
    "R56-20: all primitive method receiver union",
    "class C{#m():void{}f(o:uint8|string){o.#m();}}",
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
    "R56-21: optional call precedent rejects remaining scalar",
    "function f(n:uint8|null){n?.();}f(null);",
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
    "R56-22: ordinary null private receiver already rejected",
    "class C{#x:uint8=1;f(o:null){return o.#x;}}",
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
    "R56-E01: nested private scope",
    "class A{#x:uint8=1;f(){class B{#x:uint8=2;f(n:boolean){return n.#x;}}}}",
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
    "R56-E02: private accessor does not execute",
    "class C{get #x():uint8{globalThis.hookRan=true;return 1;}f(n:boolean){return n.#x;}}new C().f(true);",
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
    "R56-E03: static private receiver",
    "class C{static #x:uint8=1;static f(n:symbol){return n.#x;}}",
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
    "R56-E04: inherited private brand",
    "class B{#x:uint8=1;read(o:object){return o.#x;}}class C extends B{}const c=new C();globalThis.settled=String(c.read(c));",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1"
    }
  ],
  [
    "R56-E05: foreign object still checks brand dynamically",
    "class C{#x:uint8=1;read(o:object){return o.#x;}}new C().read({});",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError"
    }
  ],
  [
    "R56-E06: all-nullish optional private method",
    "class C{#m():void{globalThis.hookRan=true;}f(o:null|undefined){o?.#m();}}const c=new C();c.f(null);c.f(undefined);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "hookRan": "false"
    }
  ],
  [
    "R56-E07: generic private receiver stays open",
    "class C{#x:uint8=1;f<T: type>(o:T){return o.#x;}}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R56-E08: generic private getter specialized remains valid",
    "class C<T: type>{#v:T;constructor(v:T){this.#v=v;}get #x():T{return this.#v;}f(o:C.<T>):T{return o.#x;}}const c=new C.<uint8>(1);globalThis.settled=String(c.f(c));",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1"
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
