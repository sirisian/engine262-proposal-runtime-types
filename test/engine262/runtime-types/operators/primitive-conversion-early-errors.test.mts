import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "key bad hook",
    "function f(x:{[Symbol.toPrimitive]:number}){let o={};o[x];}"
  ],
  [
    "key bad hook executed",
    "function f(x:{[Symbol.toPrimitive]:number}){let o={};o[x];} f({[Symbol.toPrimitive]:1});"
  ],
  [
    "key object hookresult",
    "function f(x:{[Symbol.toPrimitive]:()=>object}){let o={};o[x];}"
  ],
  [
    "key object hookresult executed",
    "function f(x:{[Symbol.toPrimitive]:()=>object}){let o={};o[x];} f({[Symbol.toPrimitive](){return {};}});"
  ],
  [
    "template bad hook",
    "function f(x:{[Symbol.toPrimitive]:number}){`${x}`;}"
  ],
  [
    "template bad hook executed",
    "function f(x:{[Symbol.toPrimitive]:number}){`${x}`;} f({[Symbol.toPrimitive]:1});"
  ],
  [
    "object literal bad key",
    "function f(x:{[Symbol.toPrimitive]:number}){const o={[x]:1};}"
  ],
  [
    "object literal bad key executed",
    "function f(x:{[Symbol.toPrimitive]:number}){const o={[x]:1};} f({[Symbol.toPrimitive]:1});"
  ],
  [
    "in bad key",
    "function f(x:{[Symbol.toPrimitive]:number}){x in {};}"
  ],
  [
    "in bad key executed",
    "function f(x:{[Symbol.toPrimitive]:number}){x in {};} f({[Symbol.toPrimitive]:1});"
  ],
  [
    "edge: hook return object unused",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>object}){const o={[x]:1};}"
  ],
  [
    "edge: hook return object executed",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>object}){const o={[x]:1};}f({[Symbol.toPrimitive](hint:string):object{return {};}});"
  ],
  [
    "edge: inherited method result",
    "class B{[Symbol.toPrimitive](hint:string):object{return {};}}class C extends B{}function f(x:C){const o={[x]:1};}f(new C());"
  ]
])('R35 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "control: any",
    "function f(x:any){const o={[x]:1};}f({[Symbol.toPrimitive]:1});"
  ],
  [
    "control: legacy",
    "let x={[Symbol.toPrimitive]:1};let o={[x]:1};"
  ],
  [
    "edge: primitive symbol returned key versus text",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>symbol}){`${x}`;}f({[Symbol.toPrimitive](hint:string):symbol{return Symbol();}});"
  ]
])('R35 preserves runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "control: symbol return valid key",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>symbol}){const o={[x]:1};}f({[Symbol.toPrimitive](hint){return Symbol();}});"
  ],
  [
    "control: string return valid key",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>string}){const o={[x]:1};}f({[Symbol.toPrimitive](hint){return \"x\";}});"
  ],
  [
    "control: null fallback",
    "function f(x:{[Symbol.toPrimitive]:null}){const o={[x]:1};}f({[Symbol.toPrimitive]:null});"
  ],
  [
    "control: optional fallback",
    "function f(x:{[Symbol.toPrimitive]?:number}){const o={[x]:1};}f({});"
  ],
  [
    "control: overload suppresses conversion",
    "class C{operator*(x:number):number{return x;}[Symbol.toPrimitive](hint:string):object{return {};}}function f(x:C){x*2;}f(new C());"
  ],
  [
    "control: tag no conversion",
    "function tag(a,...b){}function f(x:{[Symbol.toPrimitive]:number}){tag`${x}`;}f({[Symbol.toPrimitive]:1});"
  ],
  [
    "control: strict equality no conversion",
    "function f(x:{[Symbol.toPrimitive]:number},y:object){x===y;}f({[Symbol.toPrimitive]:1},{});"
  ],
  [
    "control: ToBoolean no conversion",
    "function f(x:{[Symbol.toPrimitive]:number}){!!x;}f({[Symbol.toPrimitive]:1});"
  ],
  [
    "control: unknown union result",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>object|string}){const o={[x]:1};}f({[Symbol.toPrimitive](hint){return \"x\";}});"
  ],
  [
    "control: absent hook",
    "function f(x:object){const o={[x]:1};}f({});"
  ],
  [
    "control: other symbol",
    "const k=Symbol();function f(x:{[k]:number}){const o={[x]:1};}f({[k]:1});"
  ],
  [
    "edge: primitive object union result unused",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>object|string}){const o={[x]:1};}"
  ],
  [
    "edge: optional access shortcircuits",
    "function f(x:{[Symbol.toPrimitive]:number}){const o:null=null;o?.[x];}f({[Symbol.toPrimitive]:1});"
  ]
])('R35 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "all-invalid hook union",
    "function f(x:{[Symbol.toPrimitive]:number|string}){({[x]:1});}"
  ],
  [
    "all Object return union",
    "function f(x:{[Symbol.toPrimitive]:(h:string)=>(object|[].<number>)}){({[x]:1});}"
  ],
  [
    "Type Object result",
    "function f(x:{[Symbol.toPrimitive]:(h:string)=>type}){({[x]:1});}"
  ],
  [
    "inherited specialized method",
    "class B<T>{[Symbol.toPrimitive](hint:string):T{throw 1;}}class C extends B.<object>{}function f(x:C){({[x]:1});}"
  ],
  [
    "computed binding key",
    "function f(key:{[Symbol.toPrimitive]:number},o:object){const {[key]:v}=o;}"
  ],
  [
    "getter return contract",
    "class C{get [Symbol.toPrimitive]():number{throw 'must not execute';}}function f(x:C){({[x]:1});}"
  ],
  [
    "key uses string hint",
    "function f(x:{[Symbol.toPrimitive]:(hint:'number')=>string}){({[x]:1});}"
  ],
  [
    "addition uses default hint",
    "class C{[Symbol.toPrimitive](hint:'string'):string{return 'x';}}function f(x:C){x+'';}"
  ],
  [
    "unary uses number hint",
    "class C{[Symbol.toPrimitive](hint:'string'):string{return 'x';}}function f(x:C){+x;}"
  ],
  [
    "hint overload bad selected return",
    "interface Hook{(hint:'string'):object;(hint:'number'):string;}function f(x:{[Symbol.toPrimitive]:Hook}){({[x]:1});}"
  ],
  [
    "member assignment key",
    "function f(x:{[Symbol.toPrimitive]:number},o:object){o[x]=1;}"
  ],
  [
    "super property key",
    "class B{}class C extends B{f(x:{[Symbol.toPrimitive]:number}){super[x];}}"
  ]
])('R35 additional early boundary: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "valid hint-sensitive return",
    "class C{[Symbol.toPrimitive](hint:'default'):string{return 'x';}}function f(x:C){x+'';}f(new C());"
  ],
  [
    "property key valid string hint",
    "function f(x:{[Symbol.toPrimitive]:(hint:'string')=>string}){({[x]:1});}f({[Symbol.toPrimitive](hint:'string'):string{return 'x';}});"
  ],
  [
    "hint overload good selected return",
    "interface Hook{(hint:'string'):string;(hint:'number'):object;}function f(x:{[Symbol.toPrimitive]:Hook}){({[x]:1});}"
  ],
  [
    "open hook can be callable",
    "function f(x:{[Symbol.toPrimitive]:object}){({[x]:1});}f({[Symbol.toPrimitive](){return 'x';}});"
  ],
  [
    "nullish hook union fallback",
    "function f(x:{[Symbol.toPrimitive]:number|null}){({[x]:1});}f({[Symbol.toPrimitive]:null});"
  ],
  [
    "void return contract is inconclusive",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>void}){({[x]:1});}"
  ]
])('R35 additional ok boundary: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test('a valid primitive-conversion contract does not bypass reference liveness', () => {
  expectThrownKind(`
    let a:[].<{[Symbol.toPrimitive]:(hint:string)=>string}>=[{[Symbol.toPrimitive](hint:string):string{return 'x';}}];
    let ref x=a[0];a.pop();({[x]:1});
  `, 'TypeError');
});
