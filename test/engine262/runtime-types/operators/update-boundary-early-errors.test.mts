import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "x++ unused",
    "function unused(x:boolean){x++;}"
  ],
  [
    "x++ executed",
    "function unused(x:boolean){x++;} unused(true);"
  ],
  [
    "++x unused",
    "function unused(x:boolean){++x;}"
  ],
  [
    "++x executed",
    "function unused(x:boolean){++x;} unused(true);"
  ],
  [
    "x-- unused",
    "function unused(x:boolean){x--;}"
  ],
  [
    "x-- executed",
    "function unused(x:boolean){x--;} unused(true);"
  ],
  [
    "--x unused",
    "function unused(x:boolean){--x;}"
  ],
  [
    "--x executed",
    "function unused(x:boolean){--x;} unused(true);"
  ],
  [
    "update null unused",
    "function unused(x:null){x++;}"
  ],
  [
    "update null executed",
    "function unused(x:null){x++;} unused(null);"
  ],
  [
    "update undefined unused",
    "function unused(x:undefined){x++;}"
  ],
  [
    "update undefined executed",
    "function unused(x:undefined){x++;} unused(undefined);"
  ],
  [
    "update symbol unused",
    "function unused(x:symbol){x++;}"
  ],
  [
    "update symbol executed",
    "function unused(x:symbol){x++;} unused(Symbol());"
  ],
  [
    "update 1 unused",
    "function unused(x:1){x++;}"
  ],
  [
    "update 1 executed",
    "function unused(x:1){x++;} unused(1);"
  ],
  [
    "member unused",
    "class C{v:boolean=true;} function unused(c:C){++c.v;}"
  ],
  [
    "member executed",
    "class C{v:boolean=true;} function unused(c:C){++c.v;} unused(new C());"
  ],
  [
    "ref unused",
    "function unused(ref x:boolean){x++;}"
  ],
  [
    "ref executed",
    "function unused(ref x:boolean){x++;} let x:boolean=true;unused(ref x);"
  ],
  [
    "ref call unused",
    "let x:boolean=true;function loc():ref boolean{return ref x;} function unused(){loc()++;}"
  ],
  [
    "ref call executed",
    "let x:boolean=true;function loc():ref boolean{return ref x;} function unused(){loc()++;} unused();"
  ],
  [
    "ordinary assignment control",
    "function unused(x:boolean){x=2;}"
  ],
  [
    "declared update control",
    "class C{operator++():boolean{return true;}} function unused(c:C){c++;}"
  ]
])('R26 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "partial singleton union runtime",
    "function f(x:1|2){x++;} f(2);"
  ]
])('R26 retains runtime failure: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "normal numeric",
    "function f(x:uint8){x++;return x;} f(uint8(255));"
  ],
  [
    "bigint",
    "function f(x:bigint){x++;} f(1n);"
  ],
  [
    "string control",
    "function f(x:string){x++;} f(\"1\");"
  ],
  [
    "ordinary JS",
    "let x=true;x++;"
  ],
  [
    "any",
    "function f(x:any){x++;} f(true);"
  ],
  [
    "partial singleton union",
    "function f(x:1|2){x++;} f(1);"
  ],
  [
    "declared update valid",
    "class C{operator++():C{return this;}} function unused(c:C){c++;} unused(new C());"
  ]
])('R26 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "parenthesized update",
    "function f(x:boolean){(x)++;}"
  ],
  [
    "readonly",
    "class C{readonly x:uint8=1;}function f(c:C){c.x++;}"
  ],
  [
    "private",
    "class C{#x:boolean=true;f(){this.#x++;}}"
  ],
  [
    "super setter",
    "class B{get x():boolean{return true;}set x(v:boolean){}}class C extends B{f(){super.x++;}}"
  ]
])('R26 boundary control (early): %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "separate setter",
    "class C{get x():boolean{return true;}set x(v:boolean|number){}}new C().x++;"
  ],
  [
    "index setter",
    "class C{get operator[](i:uint32):boolean{return true;}set operator[](i:uint32,v:number){}}new C()[0]++;"
  ],
  [
    "declared storage wider",
    "function f(x:1|2){if(x===1){x++;}}f(1);"
  ],
  [
    "numeric and boolean union",
    "function f(x:boolean|number){x++;}f(true);"
  ],
  [
    "literal rounding fixed point",
    "function f(x:9007199254740992){x++;}f(9007199254740992);"
  ],
  [
    "legacy boolean",
    "let x=true; x++;"
  ]
])('R26 boundary control (ok): %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "stale ref",
    "let a:[].<uint8>=[1];let ref x=a[0];a.pop();x++;"
  ]
])('R26 boundary control (runtime): %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  ['x++', '1,2'], ['++x', '2,2'], ['x--', '1,0'], ['--x', '0,0'],
])('built-in %s keeps its result separate from the stored value', (expression, expected) => {
  expect(evaluated(`let x:string="1";let result=${expression};String(result)+","+x;`)).toBe(expected);
});

test('a known rejecting index setter is checked independently of its getter', () => {
  expectStaticTypeError('class C{get operator[](i:uint32):boolean{return true;}set operator[](i:uint32,v:boolean){}}function f(c:C){c[0]++;}');
});
