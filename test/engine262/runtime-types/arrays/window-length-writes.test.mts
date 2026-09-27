import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  [
    "span length annotated",
    "function f(w:Span.<uint8,2>){w.length=1;}"
  ],
  [
    "span length compound",
    "function f(w:Span.<uint8,2>){w.length+=1;}"
  ],
  [
    "span length borrow",
    "function f(w:Span.<uint8,2>){let ref r=w.length;r=1;}"
  ],
  [
    "span length destructure",
    "function f(w:Span.<uint8,2>){[w.length]=[1];}"
  ],
  [
    "window length run",
    "let a:[2].<uint8>=[1,2];const w=a.window.<2>(0);w.length=1;"
  ],
  [
    "window length shadow",
    "let a:[2].<uint8>=[1,2];const w=a.window.<2>(0);Object.defineProperty(w,'length',{value:0,writable:true});w.length=1;String(w.length);"
  ],
  [
    "unchanged length",
    "function f(w:Span.<uint8,2>){w.length=2;}"
  ],
  [
    "update length",
    "function f(w:Span.<uint8,2>){++w.length;}"
  ],
  [
    "computed length",
    "function f(w:Span.<uint8,2>){w['length']=1;}"
  ],
  [
    "object destructuring",
    "function f(w:Span.<uint8,2>){({n:w.length}={n:1});}"
  ],
  [
    "reference chain",
    "function f(w:Span.<uint8,2>){let ref r=w.length;let ref s=r;s=1;}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "span element good",
    "function f(w:Span.<uint8,2>){w[0]=1;}"
  ],
  [
    "span length read good",
    "function f(w:Span.<uint8,2>){let n:uint64=w.length;}"
  ],
  [
    "read through const ref",
    "function f(w:Span.<uint8,2>){const ref n=w.length;let x:uint64=n;}"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "array length resize good",
    "let a:[].<uint8>=[1,2];a.length=1;String(a.length);",
    "1"
  ],
  [
    "capacity shadow",
    "let a:[].<uint8>=[];Object.defineProperty(a,'capacity',{value:0,writable:true});a.capacity=1;String(a.capacity);",
    "1"
  ],
  [
    "size shadow",
    "const a=new Map.<string,uint8>();Object.defineProperty(a,'size',{value:0,writable:true});a.size=1;String(a.size);",
    "1"
  ],
  [
    "ordinary length property",
    "let o:{length:uint8}={length:1};o.length=2;String(o.length);",
    "2"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});

test("buffer length is rejected before evaluation", () => {
  expectStaticTypeError("function f(b:ArrayBuffer){const w=Span.<uint8>(b);w.length=1;}");
});

test("unsized window length is rejected before evaluation", () => {
  expectStaticTypeError("function f(a:[].<uint8>){const w=a.window(0,1);w.length=1;}");
});

test("window element valid preserves behavior", () => {
  expect(evaluated("let a:[2].<uint8>=[1,2];const w=a.window.<2>(0);w[0]=2;String(a[0]);")).toBe("2");
});
