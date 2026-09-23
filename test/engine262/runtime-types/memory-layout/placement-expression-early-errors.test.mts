import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Preserve the error phase as well as the outcome and observable effects.
test.each([
  [
    "R60-01: placement-inner-call",
    "class C{x:uint8=0;}function f(n:uint8){return new (n()) C();}",
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
    "R60-02: placement-inner-arg",
    "class C{x:uint8=0;}function g(x:uint8):ArrayBuffer{return new ArrayBuffer(8);}function f(){return new (g(\"bad\")) C();}",
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
    "R60-03: placement-offset-call",
    "class C{x:uint8=0;}function f(b:ArrayBuffer,n:uint8){return new (b,n()) C();}",
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
    "R60-04: placement-count-call",
    "class C{x:uint8=0;}function f(b:ArrayBuffer,n:uint8){return new (b,0,n()) C();}",
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
    "R60-05: placement-inner-call-run",
    "class C{x:uint8=0;}function f(n:uint8){return new (n()) C();}f(1);",
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
    "R60-06: placement-reference-state",
    "class C{x:uint8=0;}let n:uint8=1;const ref r=n;function f(b:ArrayBuffer){return new (b,do {ref r=n;0;}) C();}",
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
    "R60-07: placement-global-call-control",
    "function f(n:uint8){n();}",
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
    "R60-08: placement-control",
    "class C{x:uint8=1;}const b=new ArrayBuffer(8);new (b) C();",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R60-09: placement-arraybuffer-typed",
    "class C{x:uint8=1;}function f(b:ArrayBuffer){return new (b) C();}f(new ArrayBuffer(8));",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R60-10: placement-target-run",
    "class C {x:uint8=0;}function f(n:uint8){return new (n) C();}f(1);",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R60-11: placement-symbol",
    "class C{x:uint8=0;}function f(b:ArrayBuffer,n:symbol){return new (b,n) C();}f(new ArrayBuffer(8),Symbol());",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R60-12: placement-bigint",
    "class C{x:uint8=0;}function f(b:ArrayBuffer,n:bigint){return new (b,n) C();}f(new ArrayBuffer(8),1n);",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R60-13: placement-no-layout",
    "dynamic class C{x:string=\"\";}function f(b:ArrayBuffer){return new(b) C();}f(new ArrayBuffer(8));",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError",
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R60-14: unreachable placement child still checked",
    "class C{x:uint8=0;}function f(n:uint8){if(false){new (n()) C();}}",
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
    "R60-15: child typed operator error",
    "class C{x:uint8=0;}function f(b:ArrayBuffer,s:symbol){return new (b,+s) C();}",
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
    "R60-16: child type mismatch in nested function",
    "class C{x:uint8=0;}function f(b:ArrayBuffer){return new(b,do {const g=()=>{let n:uint8=\"bad\";};0;}) C();}",
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
    "R60-17: valid coercing offset unchanged",
    "class C{x:uint8=1;}function f(b:ArrayBuffer,s:string){return new(b,s) C();}f(new ArrayBuffer(8),\"1\");",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R60-18: dynamic placement child stays runtime",
    "class C{x:uint8=0;}function f(n:any){return new(n()) C();}f(1);",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "TypeError"
    }
  ],
  [
    "R60-19: placement effects happen exactly once",
    "class C{x:uint8=1;}let count=0;function get():ArrayBuffer{count++;return new ArrayBuffer(8);}new(get()) C();globalThis.settled=String(count);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "1"
    }
  ],
  [
    "R60-20: dynamic capacity check retained",
    "class C{x:uint8=1;}function f(b:ArrayBuffer,n:number){return new(b,n) C();}f(new ArrayBuffer(8),9);",
    {
      "completion": "throw",
      "bodyRan": "true",
      "kind": "RangeError"
    }
  ],
  [
    "R60-E01: nested generic body",
    "class C{x:uint8=0;}function f<T: type>(b:ArrayBuffer){return new(b,do {function bad<U: type>(n:uint8){n();}0;}) C();}",
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
    "R60-E02: placement private lexical scope",
    "class C{x:uint8=0;}class B{#x:uint8=1;f(b:ArrayBuffer,n:uint8){return new(b,n.#x) C();}}",
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
    "R60-E03: all placement arguments execute once",
    "class C{x:uint8=1;}let log=\"\";function b():ArrayBuffer{log+=\"b\";return new ArrayBuffer(8);}function n(s:string):number{log+=s;return 1;}new(b(),n(\"o\"),n(\"l\")) C();globalThis.settled=log;",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "bol"
    }
  ],
  [
    "R60-E04: nested readonly ref store",
    "class C{x:uint8=1;}class R{readonly x:uint8=1;}function f(b:ArrayBuffer,r:R){return new(b,do {let ref p=r.x;p=2;0;}) C();}",
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
    "R60-E05: constructor argument rebind governs placement write",
    "class C{x:uint8=1;constructor(n:number){}}class R{readonly x:uint8=1;}let n:uint8=0;const r=new R();let ref p=n;new(new ArrayBuffer(8),do{p=2;0;}) C(do{ref p=r.x;0;});",
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
    "R60-E06: constructor argument can restore writable placement alias",
    "class C{x:uint8=1;constructor(n:number){}}class R{readonly x:uint8=1;}let n:uint8=0;const r=new R();let ref p=r.x;new(new ArrayBuffer(8),do{p=2;0;}) C(do{ref p=n;0;});globalThis.settled=String(n);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "2"
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
