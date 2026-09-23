import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "text fallback unused",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>object}){`${x}`;}"
  ],
  [
    "text fallback executed",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>object}){`${x}`;}f({[Symbol.toPrimitive]:null,toString(){return {};},valueOf(){return {};}});"
  ],
  [
    "key fallback unused",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>object}){({[x]:1});}"
  ],
  [
    "key fallback executed",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>object}){({[x]:1});}f({[Symbol.toPrimitive]:null,toString(){return {};},valueOf(){return {};}});"
  ],
  [
    "number fallback unused",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>object}){+x;}"
  ],
  [
    "number fallback executed",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>object}){+x;}f({[Symbol.toPrimitive]:null,toString(){return {};},valueOf(){return {};}});"
  ],
  [
    "noncallable fallback unused",
    "function f(x:{[Symbol.toPrimitive]:null,toString:number,valueOf:number}){`${x}`;}"
  ],
  [
    "noncallable fallback executed",
    "function f(x:{[Symbol.toPrimitive]:null,toString:number,valueOf:number}){`${x}`;}f({[Symbol.toPrimitive]:null,toString:1,valueOf:2});"
  ],
  [
    "undefined exotic hook unused",
    "function f(x:{[Symbol.toPrimitive]:undefined,toString:()=>object,valueOf:()=>object}){`${x}`;}"
  ],
  [
    "undefined exotic hook executed",
    "function f(x:{[Symbol.toPrimitive]:undefined,toString:()=>object,valueOf:()=>object}){`${x}`;}f({[Symbol.toPrimitive]:undefined,toString(){return {};},valueOf(){return {};}});"
  ]
])('R39 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any boundary",
    "function f(x:any){`${x}`;}f({[Symbol.toPrimitive]:null,toString(){return {};},valueOf(){return {};}});"
  ],
  [
    "legacy",
    "let x={[Symbol.toPrimitive]:null,toString(){return {};},valueOf(){return {};}};`${x}`;"
  ]
])('R39 retains runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "second method succeeds",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>string}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive]:null,toString(){return {};},valueOf(){return \"ok\";}});",
    "ok"
  ],
  [
    "first method succeeds and skips second",
    "let hits=0;function f(x:{[Symbol.toPrimitive]:null,toString:()=>string,valueOf:()=>object}){return `${x}`;}f({[Symbol.toPrimitive]:null,toString(){return \"ok\";},valueOf(){hits++;return {};}});globalThis.settled=String(hits);",
    "0"
  ],
  [
    "skip noncallable first",
    "function f(x:{[Symbol.toPrimitive]:null,toString:number,valueOf:()=>string}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive]:null,toString:1,valueOf(){return \"ok\";}});",
    "ok"
  ],
  [
    "exotic success overrides fallback",
    "function f(x:{[Symbol.toPrimitive]:()=>string,toString:()=>object,valueOf:()=>object}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive](){return \"ok\";},toString(){return {};},valueOf(){return {};}});",
    "ok"
  ],
  [
    "undeclared exotic can exist",
    "function f(x:{toString:()=>object,valueOf:()=>object}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive](){return \"ok\";},toString(){return {};},valueOf(){return {};}});",
    "ok"
  ],
  [
    "unknown result",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>any,valueOf:()=>object}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive]:null,toString(){return \"ok\";},valueOf(){return {};}});",
    "ok"
  ],
  [
    "viable result union",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object|string,valueOf:()=>object}){return `${x}`;}globalThis.settled=f({[Symbol.toPrimitive]:null,toString(){return \"ok\";},valueOf(){return {};}});",
    "ok"
  ]
])('R39 preserves values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});

test.each([
  [
    "specialized fallback",
    "class C<T: type>{[Symbol.toPrimitive]:null=null;toString():T{throw 0;}valueOf():object{return {};}}function f(x:C.<object>){`${x}`;}"
  ],
  [
    "inherited fallback",
    "class B{get [Symbol.toPrimitive]():null{return null;}toString():object{return {};}valueOf():object{return {};}}class C extends B{}function f(x:C){`${x}`;}"
  ],
  [
    "null or invalid exotic",
    "function f(x:{[Symbol.toPrimitive]:null|number,toString:()=>object,valueOf:()=>object}){`${x}`;}"
  ]
])('R39 additional early: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "optional exotic unknown valid path",
    "function f(x:{[Symbol.toPrimitive]?:()=>string,toString:()=>object,valueOf:()=>object}){`${x}`;}"
  ],
  [
    "missing fallback member",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object}){`${x}`;}"
  ],
  [
    "open callable fallback",
    "function f(x:{[Symbol.toPrimitive]:null,toString:object,valueOf:()=>object}){`${x}`;}"
  ],
  [
    "void result unknown",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>void,valueOf:()=>object}){`${x}`;}"
  ]
])('R39 additional ok: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "number hint skips second",
    "let hits=0;function f(x:{[Symbol.toPrimitive]:null,valueOf:()=>number,toString:()=>object}){return +x;}f({[Symbol.toPrimitive]:null,valueOf(){return 3;},toString(){hits++;return {};}});globalThis.settled=String(hits);",
    "0"
  ],
  [
    "getter not executed",
    "let reads=0;class C{get [Symbol.toPrimitive]():null{reads++;return null;}get toString():()=>string{reads++;return ()=>\"ok\";}}function f(x:C){`${x}`;}globalThis.settled=String(reads);",
    "0"
  ],
  [
    "original throw preserved",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>string,valueOf:()=>object}){`${x}`;}try{f({[Symbol.toPrimitive]:null,toString(){throw \"original\";},valueOf(){return {};}});}catch(e){globalThis.settled=e;}",
    "original"
  ]
])('R39 additional values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});
