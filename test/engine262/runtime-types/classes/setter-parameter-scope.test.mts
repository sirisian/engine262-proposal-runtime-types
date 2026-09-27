import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  [
    "setter body",
    "class C{set x(v:uint8){v='bad';}}"
  ],
  [
    "object setter",
    "const c={set x(v:uint8){v='bad';}};"
  ],
  [
    "setter body free shadow",
    "let v:string='outer';class C{set x(v:uint8){let s:string=v;}}"
  ],
  [
    "method control",
    "class C{x(v:uint8){v='bad';}}"
  ],
  [
    "setter run",
    "class C{set x(v:uint8){v='bad';}}const c=new C();c.x=1;"
  ],
  [
    "static setter",
    "class C{static set x(v:uint8){v='bad';}}"
  ],
  [
    "private setter",
    "class C{set #x(v:uint8){v='bad';}}"
  ],
  [
    "destructured setter",
    "class C{set x({v}:{v:uint8}){v='bad';}}"
  ],
  [
    "setter local declaration",
    "class C{set x(v:uint8){let n:string=v;}}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "setter good",
    "class C{set x(v:uint8){v=1;}}"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "setter scopes shadow independently",
    "let v:string='outer';class C{set x(v:uint8){let n:uint8=v;}}String(v);",
    "outer"
  ],
  [
    "computed names use outer scope",
    "const v='x';class C{set [v](v:uint8){let n:uint8=v;}}new C().x=1;String(v);",
    "x"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});
