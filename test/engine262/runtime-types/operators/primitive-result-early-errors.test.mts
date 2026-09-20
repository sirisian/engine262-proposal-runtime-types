import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "text result unused",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol}){`${x}`;}"
  ],
  [
    "text result executed",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol}){`${x}`;}f({[Symbol.toPrimitive](){return Symbol();}});"
  ],
  [
    "concatenation result unused",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol}){\"\"+x;}"
  ],
  [
    "concatenation result executed",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol}){\"\"+x;}f({[Symbol.toPrimitive](){return Symbol();}});"
  ],
  [
    "unary number result unused",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol}){+x;}"
  ],
  [
    "unary number result executed",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol}){+x;}f({[Symbol.toPrimitive](){return Symbol();}});"
  ],
  [
    "binary result unused",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol},n:number){n*x;}"
  ],
  [
    "binary result executed",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol},n:number){n*x;}f({[Symbol.toPrimitive](){return Symbol();}},1);"
  ],
  [
    "ordered result unused",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol},n:number){n<x;}"
  ],
  [
    "ordered result executed",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol},n:number){n<x;}f({[Symbol.toPrimitive](){return Symbol();}},1);"
  ],
  [
    "bigint to number unused",
    "function f(x:{[Symbol.toPrimitive]:()=>bigint}){+x;}"
  ],
  [
    "bigint to number executed",
    "function f(x:{[Symbol.toPrimitive]:()=>bigint}){+x;}f({[Symbol.toPrimitive](){return 1n;}});"
  ]
])('R40 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any boundary",
    "function f(x:any){`${x}`;}f({[Symbol.toPrimitive](){return Symbol();}});"
  ],
  [
    "legacy",
    "let x={[Symbol.toPrimitive](){return Symbol();}};`${x}`;"
  ]
])('R40 retains runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "symbol property key",
    "const k=Symbol();function f(x:{[Symbol.toPrimitive]:()=>symbol}){return {[x]:1}[k];}globalThis.settled=String(f({[Symbol.toPrimitive](){return k;}}));",
    "1"
  ],
  [
    "symbol in key",
    "const k=Symbol();function f(x:{[Symbol.toPrimitive]:()=>symbol}){return x in {[k]:1};}globalThis.settled=String(f({[Symbol.toPrimitive](){return k;}}));",
    "true"
  ],
  [
    "bigint negate",
    "function f(x:{[Symbol.toPrimitive]:()=>bigint}){return -x;}globalThis.settled=String(f({[Symbol.toPrimitive](){return 1n;}}));",
    "-1"
  ],
  [
    "bigint text",
    "function f(x:{[Symbol.toPrimitive]:()=>bigint}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive](){return 1n;}});",
    "1"
  ],
  [
    "viable result union",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol|string}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive](){return \"ok\";}});",
    "ok"
  ],
  [
    "unknown result",
    "function f(x:{[Symbol.toPrimitive]:()=>any}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive](){return \"ok\";}});",
    "ok"
  ],
  [
    "boolean skips hook",
    "let hits=0;function f(x:{[Symbol.toPrimitive]:()=>symbol}){return !!x;}f({[Symbol.toPrimitive](){hits++;return Symbol();}});globalThis.settled=String(hits);",
    "0"
  ],
  [
    "tag skips hook",
    "let hits=0;function tag(strings:any,x:any){return 1;}function f(x:{[Symbol.toPrimitive]:()=>symbol}){return tag`${x}`;}f({[Symbol.toPrimitive](){hits++;return Symbol();}});globalThis.settled=String(hits);",
    "0"
  ]
])('R40 preserves values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});

test.each([
  [
    "string hint overload invalid result",
    "function f(x:{[Symbol.toPrimitive]:{(h:\"string\"):symbol;(h:\"number\"):number}}){`${x}`;}"
  ],
  [
    "optional parameter supplied wrong hint",
    "function f(x:{[Symbol.toPrimitive]:(hint?:number)=>string}){`${x}`;}"
  ],
  [
    "all forbidden results",
    "function f(x:{[Symbol.toPrimitive]:()=>symbol|object}){`${x}`;}"
  ],
  [
    "specialized result",
    "class C<T>{[Symbol.toPrimitive](hint:string):T{throw 0;}}function f(x:C.<symbol>){`${x}`;}"
  ],
  [
    "inherited result",
    "class B{[Symbol.toPrimitive](hint:string):symbol{return Symbol();}}class C extends B{}function f(x:C){`${x}`;}"
  ],
  [
    "ordinary successful result then bad consumer",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>symbol,valueOf:()=>string}){`${x}`;}"
  ],
  [
    "projected BigInt shift",
    "class C{[Symbol.toPrimitive](hint:string):bigint{return 8n;}}function f(x:C,n:bigint){x >>> n;}"
  ],
  [
    "projected BigInt Number mix",
    "class C{[Symbol.toPrimitive](hint:string):bigint{return 8n;}}function f(x:C,n:number){x * n;}"
  ]
])('R40 additional early: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "number hint overload valid",
    "function f(x:{[Symbol.toPrimitive]:{(h:\"string\"):symbol;(h:\"number\"):number}}){+x;}"
  ],
  [
    "object type retained",
    "function f(x:{[Symbol.toPrimitive]:()=>string,label:number}){`${x}`;let y:object=x;let n:number=x.label;}f({[Symbol.toPrimitive](){return \"ok\";},label:1});"
  ]
])('R40 additional ok: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "operator skips bad result",
    "class C{operator*(n:number):number{return n;}[Symbol.toPrimitive](hint:string):symbol{return Symbol();}}function f(x:C,n:number){return x*n;}globalThis.settled=String(f(new C(),4));",
    "4"
  ],
  [
    "optional skips key conversion",
    "function f(x:null,key:{[Symbol.toPrimitive]:()=>symbol}){return x?.[key];}globalThis.settled=String(f(null,{[Symbol.toPrimitive](){throw 0;}}));",
    "undefined"
  ],
  [
    "non well-known symbol",
    "const key=Symbol();function f(x:{[key]:()=>symbol}){return `${x}`;}globalThis.settled=f({[key](){return Symbol();}});",
    "[object Object]"
  ]
])('R40 additional values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});
