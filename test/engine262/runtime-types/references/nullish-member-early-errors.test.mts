import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "dot unused",
    "function f(x:null){x.a;}"
  ],
  [
    "dot executed",
    "function f(x:null){x.a;}f(null);"
  ],
  [
    "computed unused",
    "function f(x:undefined){x[0];}"
  ],
  [
    "computed executed",
    "function f(x:undefined){x[0];}f(undefined);"
  ],
  [
    "all-nullish union unused",
    "function f(x:null|undefined){x.a;}"
  ],
  [
    "all-nullish union executed",
    "function f(x:null|undefined){x.a;}f(null);"
  ],
  [
    "store unused",
    "function f(x:null){x.a=1;}"
  ],
  [
    "store executed",
    "function f(x:null){x.a=1;}f(null);"
  ],
  [
    "delete unused",
    "function f(x:null){delete x.a;}"
  ],
  [
    "delete executed",
    "function f(x:null){delete x.a;}f(null);"
  ],
  [
    "call unused",
    "function f(x:null){x.a();}"
  ],
  [
    "call executed",
    "function f(x:null){x.a();}f(null);"
  ],
  [
    "typeof unused",
    "function f(x:null){typeof x.a;}"
  ],
  [
    "typeof executed",
    "function f(x:null){typeof x.a;}f(null);"
  ],
  [
    "nested contribution unused",
    "function f(x:{child:null}){x.child.a;}"
  ],
  [
    "nested contribution executed",
    "function f(x:{child:null}){x.child.a;}f({child:null});"
  ],
  [
    "grouped optional unused",
    "function f(x:null){(x?.a).b;}"
  ],
  [
    "grouped optional executed",
    "function f(x:null){(x?.a).b;}f(null);"
  ],
  [
    "existing mixed-nullable member rejection object value",
    "function f(x:null|{a:number}){return x.a;}globalThis.settled=String(f({a:2}));"
  ],
  [
    "existing mixed-nullable member rejection null value",
    "function f(x:null|{a:number}){return x.a;}f(null);"
  ]
])('R36 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any boundary",
    "function f(x:any){x.a;}f(null);"
  ],
  [
    "legacy",
    "let x=null;x.a;"
  ]
])('R36 retains runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "optional dot",
    "function f(x:null){return x?.a;}globalThis.settled=String(f(null));",
    "undefined"
  ],
  [
    "optional continuous chain",
    "function f(x:null){return x?.a.b;}globalThis.settled=String(f(null));",
    "undefined"
  ],
  [
    "optional computed skips key",
    "let hits=0;function f(x:null){return x?.[hits++];}f(null);globalThis.settled=String(hits);",
    "0"
  ],
  [
    "boxed string",
    "function f(x:string){return x.length;}globalThis.settled=String(f(\"ok\"));",
    "2"
  ],
  [
    "boxed number",
    "function f(x:number){return x.toString();}globalThis.settled=f(3);",
    "3"
  ]
])('R36 preserves values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});

test.each([
  [
    "computed store",
    "function f(x:undefined,k:string){x[k]=1;}"
  ],
  [
    "computed update",
    "function f(x:null,k:symbol){++x[k];}"
  ],
  [
    "alias",
    "function f(x:null){const y=x;(y).a;}"
  ],
  [
    "specialized field",
    "class Box<T: type>{v:T;}function f(x:Box.<null>){x.v.a;}"
  ]
])('R36 additional early: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "unrelated annotation",
    "function f(x){let n:number=1;x.a;}f(null);"
  ],
  [
    "liveness retained",
    "let a:[].<string>=[\"a\",\"b\"];let ref r=a[1];a.pop();r.length;"
  ]
])('R36 additional runtime: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "open object unknown key",
    "function f(x:object){x.missing;}f({});"
  ],
  [
    "never receiver",
    "function f(x:never){x.a;}"
  ]
])('R36 additional ok: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "optional deletion",
    "function f(x:null){return delete x?.a;}globalThis.settled=String(f(null));",
    "true"
  ]
])('R36 additional values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});
