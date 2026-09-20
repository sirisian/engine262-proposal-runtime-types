import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "two bigint operands unused",
    "function f(x:bigint,y:bigint){x >>> y;}"
  ],
  [
    "two bigint operands executed",
    "function f(x:bigint,y:bigint){x >>> y;}f(8n,1n);"
  ],
  [
    "compound unused",
    "function f(x:bigint,y:bigint){x >>>= y;}"
  ],
  [
    "compound executed",
    "function f(x:bigint,y:bigint){x >>>= y;}f(8n,1n);"
  ],
  [
    "adopting literal unused",
    "function f(x:bigint){x >>> 1;}"
  ],
  [
    "adopting literal executed",
    "function f(x:bigint){x >>> 1;}f(8n);"
  ],
  [
    "bigint literal unused",
    "function f(x:bigint){x >>> 1n;}"
  ],
  [
    "bigint literal executed",
    "function f(x:bigint){x >>> 1n;}f(8n);"
  ],
  [
    "all-invalid union unused",
    "function f(x:bigint|boolean,y:bigint){x >>> y;}"
  ],
  [
    "all-invalid union executed",
    "function f(x:bigint|boolean,y:bigint){x >>> y;}f(8n,1n);"
  ]
])('R37 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "viable union failing pair",
    "function f(x:number|bigint,y:number|bigint){return x >>> y;}f(8n,1n);"
  ],
  [
    "any boundary",
    "function f(x:any,y:any){x >>> y;}f(8n,1n);"
  ],
  [
    "legacy",
    "8n >>> 1n;"
  ]
])('R37 retains runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "signed right shift",
    "function f(x:bigint,y:bigint){return x >> y;}globalThis.settled=String(f(8n,1n));",
    "4"
  ],
  [
    "left shift",
    "function f(x:bigint,y:bigint){return x << y;}globalThis.settled=String(f(8n,1n));",
    "16"
  ],
  [
    "number unsigned",
    "function f(x:number,y:number){return x >>> y;}globalThis.settled=String(f(8,1));",
    "4"
  ],
  [
    "uint64 unsigned",
    "function f(x:uint64,y:uint64){return x >>> y;}globalThis.settled=String(f(uint64(8),uint64(1)));",
    "4"
  ],
  [
    "declared operator",
    "class C{operator>>>(n:bigint):string{return \"shifted\";}}function f(x:C,y:bigint){return x >>> y;}globalThis.settled=f(new C(),1n);",
    "shifted"
  ],
  [
    "viable union",
    "function f(x:number|bigint,y:number|bigint){return x >>> y;}globalThis.settled=String(f(8,1));",
    "4"
  ]
])('R37 preserves values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});

test.each([
  [
    "reference compound",
    "function f(ref x:bigint,n:bigint){x >>>= n;}"
  ],
  [
    "constant adoption",
    "const K=1;function f(x:bigint){x >>> K;}"
  ],
  [
    "inherited field",
    "class B{v:bigint;}class C extends B{}function f(x:C){x.v >>> 1;}"
  ],
  [
    "specialized field",
    "class Box<T>{v:T;}function f(x:Box.<bigint>){x.v >>> 1;}"
  ]
])('R37 additional early: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "unrelated annotation",
    "let n:number=1;8n >>> 1n;"
  ]
])('R37 additional runtime: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "unknown right",
    "function f(x:bigint,n:any){x >>> n;}"
  ],
  [
    "unknown left",
    "function f(x:any,n:bigint){x >>> n;}"
  ]
])('R37 additional ok: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "explicit Number conversion",
    "function f(x:bigint,n:bigint){return Number(x) >>> Number(n);}globalThis.settled=String(f(8n,1n));",
    "4"
  ]
])('R37 additional values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});
