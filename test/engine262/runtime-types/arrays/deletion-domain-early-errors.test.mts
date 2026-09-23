import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "growable array unused",
    "function f(a:[].<uint8>){delete a[0];}"
  ],
  [
    "growable array executed",
    "function f(a:[].<uint8>){delete a[0];}f([1]);"
  ],
  [
    "defaulted fixed tuple unused",
    "function f(a:[uint8=1]){delete a[0];}"
  ],
  [
    "defaulted fixed tuple executed",
    "function f(a:[uint8=1]){delete a[0];}f([]);"
  ],
  [
    "trailing tuple rest unused",
    "function f(a:[uint8,...[].<uint8>]){delete a[1];}"
  ],
  [
    "trailing tuple rest executed",
    "function f(a:[uint8,...[].<uint8>]){delete a[1];}f([1,2]);"
  ],
  [
    "rest beyond current length unused",
    "function f(a:[uint8,...[].<uint8>]){delete a[99];}"
  ],
  [
    "rest beyond current length executed",
    "function f(a:[uint8,...[].<uint8>]){delete a[99];}f([1]);"
  ],
  [
    "empty growable array unused",
    "function f(a:[].<uint8>){delete a[99];}"
  ],
  [
    "empty growable array executed",
    "function f(a:[].<uint8>){delete a[99];}f([]);"
  ],
  [
    "fixed and growable union unused",
    "function f(a:[2].<uint8>|[].<uint8>){delete a[0];}"
  ],
  [
    "fixed and growable union executed",
    "function f(a:[2].<uint8>|[].<uint8>){delete a[0];}let a:[2].<uint8>=[1,2];f(a);"
  ],
  [
    "optional receiver unused",
    "function f(a:[].<uint8>|null){delete a?.[0];}"
  ],
  [
    "optional receiver executed",
    "function f(a:[].<uint8>|null){delete a?.[0];}let a:[].<uint8>=[1];f(a);"
  ],
  [
    "existing fixed position",
    "function f(a:[2].<uint8>){delete a[0];}"
  ]
])('R43 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any runtime",
    "let a:[].<uint8>=[1];function f(x:any){delete x[0];}f(a);"
  ],
  [
    "unknown key runtime",
    "function f(a:[].<uint8>,k:string){delete a[k];}f([1],\"0\");"
  ]
])('R43 retains runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "optional null skip",
    "function f(a:null){delete a?.[0];}f(null);"
  ],
  [
    "ordinary extra",
    "let a:[].<uint8>=[1];a.extra=3;delete a.extra;"
  ],
  [
    "noncanonical numeric property",
    "let a:[].<uint8>=[1];a[\"01\"]=3;delete a[\"01\"];"
  ],
  [
    "fixed tuple nonposition",
    "let a:[uint8=1]=[];delete a[9];"
  ],
  [
    "legacy hole",
    "let a=[1];delete a[0];"
  ],
  [
    "legal shrink",
    "let a:[].<uint8>=[1,2];a.length=1;"
  ],
  [
    "mixed nonposition remains dynamic",
    "function f(a:[uint8]|[].<uint8>){delete a[2];}let a:[uint8]=[1];f(a);"
  ]
])('R43 preserves valid behavior: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});


test.each([
  [
    "canonical const key",
    "const K=\"0\";function f(a:[].<uint8>){delete (a[K]);}"
  ],
  [
    "shared array",
    "function f(a:shared [].<uint8>){delete a[0];}"
  ],
  [
    "unknown element type",
    "function f<T: type>(a:[].<T>){delete a[0];}"
  ],
  [
    "empty tuple default",
    "function f(a:[uint8=1,string=\"s\"]){delete a[1];}"
  ],
  [
    "rest prefix default",
    "function f(a:[uint8=1,...[].<string>]){delete a[0];}"
  ],
  [
    "rest alias",
    "type Tail=[].<uint8>;function f(a:[uint8,...Tail]){delete a[100];}"
  ],
  [
    "typed any element",
    "function f(a:[].<any>){delete a[0];}"
  ]
])('R43 rejects a proved edge case: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "symbol key",
    "function f(a:[].<uint8>){delete a[Symbol.iterator];}"
  ],
  [
    "max non-index string",
    "function f(a:[].<uint8>){delete a[\"4294967295\"];}f([1]);"
  ],
  [
    "negative property",
    "function f(a:[].<uint8>){delete a[\"-1\"];}f([1]);"
  ],
  [
    "fixed rest domain unresolved",
    "function f(a:[...[2].<uint8>]){delete a[0];}"
  ],
  [
    "nonfinal rest domain unresolved",
    "function f(a:[...[].<uint8>,string]){delete a[0];}"
  ],
  [
    "ref iteration unaffected",
    "let a:[].<uint8>=[1,2];for(let ref x of a){x=3;}"
  ]
])('R43 accepts a viable edge case: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});
