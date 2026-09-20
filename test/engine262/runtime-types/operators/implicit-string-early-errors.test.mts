import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "template unused",
    "function unused(s:symbol){`${s}`;}"
  ],
  [
    "template executed",
    "function unused(s:symbol){`${s}`;} unused(Symbol());"
  ],
  [
    "left concat unused",
    "function unused(s:symbol){\"x\"+s;}"
  ],
  [
    "left concat executed",
    "function unused(s:symbol){\"x\"+s;} unused(Symbol());"
  ],
  [
    "right concat unused",
    "function unused(s:symbol){s+\"x\";}"
  ],
  [
    "right concat executed",
    "function unused(s:symbol){s+\"x\";} unused(Symbol());"
  ],
  [
    "member unused",
    "function unused(o:{s:symbol}){`${o.s}`;}"
  ],
  [
    "member executed",
    "function unused(o:{s:symbol}){`${o.s}`;} unused({s:Symbol()});"
  ],
  [
    "return unused",
    "function get():symbol{return Symbol();}function unused(){`${get()}`;}"
  ],
  [
    "return executed",
    "function get():symbol{return Symbol();}function unused(){`${get()}`;} unused();"
  ]
])('R30 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "union dynamic failure",
    "function unused(v:symbol|string){`${v}`;}unused(Symbol());"
  ],
  [
    "any runtime",
    "function unused(s:any){`${s}`;}unused(Symbol());"
  ],
  [
    "legacy runtime",
    "`${Symbol()}`;"
  ],
  [
    "unrelated annotation",
    "function unused(){let n:uint8=1;`${Symbol()}`;}unused();"
  ]
])('R30 retains runtime failure: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "explicit String",
    "function unused(s:symbol){`${String(s)}`;}unused(Symbol());"
  ],
  [
    "tagged",
    "function tag(s:any,v:symbol):symbol{return v;}function unused(v:symbol){tag`${v}`;}unused(Symbol());"
  ],
  [
    "union valid",
    "function unused(v:symbol|string){`${v}`;}unused(\"s\");"
  ],
  [
    "any unused",
    "function unused(s:any){`${s}`;}"
  ],
  [
    "lexical shadow",
    "function unused(s:symbol){{const s=\"text\";`${s}`;}}unused(Symbol());"
  ],
  [
    "declared operator",
    "class C{operator+(s:symbol):string{return \"ok\";}}function unused(c:C,s:symbol){c+s;}unused(new C(),Symbol());"
  ]
])('R30 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "returned template",
    "function f(x:symbol):string{return `${x}`;}"
  ],
  [
    "nested untagged",
    "function tag(a,...x){return x;}function f(x:symbol){tag`${`${x}`}`;}"
  ],
  [
    "parenthesized symbol",
    "function f(x:symbol){`${(x)}`;}"
  ]
])('R30 boundary control (early): %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "shadowed symbol",
    "const x:symbol=Symbol();function f(x){return `${x}`;}f(\"yes\");"
  ],
  [
    "tagged typed raw",
    "function tag(a,...xs){return xs[0];}function f(x:symbol){tag`${x}`;}f(Symbol());"
  ],
  [
    "mutable symbol inference",
    "let x=Symbol();x=\"yes\";`${x}`;"
  ]
])('R30 boundary control (ok): %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "catchable dynamic",
    "function f(x:any){return `${x}`;}f(Symbol());"
  ]
])('R30 boundary control (runtime): %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});
