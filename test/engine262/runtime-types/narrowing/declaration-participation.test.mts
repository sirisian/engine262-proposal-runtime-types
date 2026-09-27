import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  [
    "guard null equality",
    "function f(v:{x:uint8}|null){if(v===null){v.x;}}"
  ],
  [
    "guard null declared",
    "function isNull(v:any):v is null{return v===null;}function f(v:{x:uint8}|null){if(isNull(v)){v.x;}}"
  ],
  [
    "guard null direct",
    "function f(v:null){v.x;}"
  ],
  [
    "guard symbol arithmetic",
    "function f(v:symbol|string){if(typeof v==='symbol'){v*2;}}"
  ],
  [
    "guard symbol arithmetic control",
    "function f(v:symbol){v*2;}"
  ],
  [
    "guard private primitive",
    "class C{#x:uint8;f(v:C|uint8){if(v instanceof uint8){v.#x;}}}"
  ],
  [
    "guard private primitive control",
    "class C{#x:uint8;f(v:uint8){v.#x;}}"
  ],
  [
    "guard null run",
    "function isNull(v:any):v is null{return v===null;}function f(v:{x:uint8}|null){if(isNull(v)){v.x;}}f(null);"
  ],
  [
    "typeof undefined",
    "function f(v:{x:uint8}|undefined){if(typeof v==='undefined'){v.x;}}"
  ],
  [
    "else null",
    "function f(v:{x:uint8}|null){if(v!==null){}else{v.x;}}"
  ],
  [
    "conditional null arm",
    "function f(v:{x:uint8}|null){return v===null?v.x:0;}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "guard null optional",
    "function f(v:{x:uint8}|null){if(v===null){v?.x;}}"
  ],
  [
    "guard nonnull positive",
    "function f(v:{x:uint8}|null){if(v!==null){let n:uint8=v.x;}}"
  ],
  [
    "untyped narrowing remains dynamic",
    "function f(v){if(v===null){v.x;}}"
  ],
  [
    "explicit any narrowing",
    "function f(v:any){if(v===null){v.x;}}"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "lexical shadow",
    "function f(v:{x:uint8}|null){if(v===null){let v:any={x:1};return v.x;}}String(f(null));",
    "1"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});
