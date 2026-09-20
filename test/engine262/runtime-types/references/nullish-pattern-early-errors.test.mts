import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "object null const {}=x;",
    "function f(x:null){const {}=x;}"
  ],
  [
    "object null const {}=x; executed",
    "function f(x:null){const {}=x;} f(null);"
  ],
  [
    "object null const {a}=x;",
    "function f(x:null){const {a}=x;}"
  ],
  [
    "object null const {a}=x; executed",
    "function f(x:null){const {a}=x;} f(null);"
  ],
  [
    "object null const {...a}=x;",
    "function f(x:null){const {...a}=x;}"
  ],
  [
    "object null const {...a}=x; executed",
    "function f(x:null){const {...a}=x;} f(null);"
  ],
  [
    "object null let a;({a}=x);",
    "function f(x:null){let a;({a}=x);}"
  ],
  [
    "object null let a;({a}=x); executed",
    "function f(x:null){let a;({a}=x);} f(null);"
  ],
  [
    "object null ({}=x);",
    "function f(x:null){({}=x);}"
  ],
  [
    "object null ({}=x); executed",
    "function f(x:null){({}=x);} f(null);"
  ],
  [
    "undefined object",
    "function f(x:undefined){const {a}=x;}"
  ],
  [
    "undefined object executed",
    "function f(x:undefined){const {a}=x;} f(undefined);"
  ],
  [
    "nested null pattern",
    "function f(x:{p:null}){const {p:{a}}=x;}"
  ],
  [
    "nested null pattern executed",
    "function f(x:{p:null}){const {p:{a}}=x;} f({p:null});"
  ],
  [
    "pattern parameter",
    "function f({a}:null){}"
  ],
  [
    "pattern parameter executed",
    "function f({a}:null){} f(null);"
  ],
  [
    "control: all nullish union",
    "function f(x:null|undefined){const {}=x;}f(null);"
  ],
  [
    "control: property default cannot rescue",
    "function f(x:null){const {a=1}=x;}f(null);"
  ],
  [
    "control: forof elements",
    "function f(xs:[].<null>){for(const {} of xs){}}f([null]);"
  ]
])('R32 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "control: nullable bad",
    "function f(x:null|{a:number}){const {a}=x;}f(null);"
  ],
  [
    "control: any",
    "function f(x:any){const {}=x;}f(null);"
  ],
  [
    "control: legacy",
    "const {}=null;"
  ],
  [
    "control: readonly no liveness bypass",
    "let a:[].<{x:uint8}>=[{x:1}];let ref r=a[0];a.pop();const {}=r;"
  ]
])('R32 preserves runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "control: nullable good",
    "function f(x:null|{a:number}){const {a}=x;}f({a:1});"
  ],
  [
    "control: empty number box",
    "function f(x:number){const {}=x;}f(1);"
  ],
  [
    "control: string box",
    "function f(x:string){const {length}=x;}f(\"yes\");"
  ],
  [
    "control: typed numeric box",
    "function f(x:uint8){const {}=x;}f(uint8(1));"
  ],
  [
    "control: object spread null",
    "function f(x:null){const a={...x};}f(null);"
  ],
  [
    "control: fallback rescues",
    "function f(x:null|{a:number}){const {a}=x??{a:1};}f(null);"
  ]
])('R32 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "nullish assignment union",
    "function f(x:null|undefined){({}=x);}"
  ],
  [
    "nested null cannot use default",
    "function f(x:{p:null}){const {p:{a}={a:1}}=x;}"
  ],
  [
    "inherited member contribution",
    "class B{p:null=null;}class C extends B{}function f(x:C){const {}=x.p;}"
  ]
])('R32 additional early boundary: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "legacy const alias remains dynamic",
    "const x=null;const {}=x;"
  ]
])('R32 additional runtime boundary: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "nested undefined takes default",
    "function f(x:{p:undefined}){const {p:{a}={a:1}}=x;}f({p:undefined});"
  ]
])('R32 additional ok boundary: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});
