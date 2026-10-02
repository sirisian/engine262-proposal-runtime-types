import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  [
    "setter read call",
    "class C{set x(v:()=>void){}}function f(c:C){c.x();}"
  ],
  [
    "setter read call run",
    "class C{set x(v:()=>void){}}function f(c:C){c.x();}f(new C());"
  ],
  [
    "object setter call",
    "const o={set x(v:()=>void){}};function f(p:number){o.x();}"
  ],
  [
    "static setter call",
    "class C{static set x(v:()=>void){}}function f(p:number){C.x();}"
  ],
  [
    "private setter call",
    "class C{set #x(v:()=>void){}f(p:number){this.#x();}}"
  ],
  [
    "setter masks inherited getter",
    "class B{get x():()=>void{return ()=>{};}}class C extends B{set x(v:()=>void){}}function f(c:C){c.x();}"
  ],
  [
    "setter write mismatch",
    "class C{set x(v:uint8){}}function f(c:C){c.x='bad';}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "setter read call control",
    "class C{get x():()=>void{return ()=>{};}set x(v:()=>void){}}function f(c:C){c.x();}f(new C());"
  ],
  [
    "setter undefined read good",
    "class C{set x(v:uint8){}}function f(c:C){let u:undefined=c.x;}"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "setter undefined truth",
    "class C{set x(v:uint8){}}const c=new C();String(c.x===undefined);",
    "true"
  ],
  [
    "object read undefined",
    "const o={set x(v:uint8){}};let u:undefined=o.x;String(u);",
    "undefined"
  ],
  [
    "getter after setter",
    "const o={set x(v:uint8){},get x():uint8{return 1;}};let n:uint8=o.x;String(n);",
    "1"
  ],
  [
    "setter after getter",
    "const o={get x():uint8{return 1;},set x(v:uint8){}};o.x=2;String(o.x);",
    "1"
  ],
  [
    "generic setter writes",
    "class C<T:type>{set x(v:T){}}const c=new C.<uint8>();c.x=1;let u:undefined=c.x;String(u);",
    "undefined"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});

test("setter symbol read is rejected before evaluation", () => {
  // #sec-checked-code: the call is in checked code, so it is refused early.
  expectStaticTypeError("const o={set [Symbol.iterator](v:()=>void){}};function f(p:number){o[Symbol.iterator]();}");
});
