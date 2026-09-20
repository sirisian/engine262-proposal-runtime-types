import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "two unions * unused",
    "function unused(a:uint8|int8,b:uint16|int16){a*b;}"
  ],
  [
    "two unions * executed",
    "function unused(a:uint8|int8,b:uint16|int16){a*b;} unused(uint8(1),uint16(1));"
  ],
  [
    "two unions < unused",
    "function unused(a:uint8|int8,b:uint16|int16){a<b;}"
  ],
  [
    "two unions < executed",
    "function unused(a:uint8|int8,b:uint16|int16){a<b;} unused(uint8(1),uint16(1));"
  ],
  [
    "relational one union unused",
    "function unused(a:uint8|int8,b:uint16){a<b;}"
  ],
  [
    "relational one union executed",
    "function unused(a:uint8|int8,b:uint16){a<b;} unused(uint8(1),uint16(1));"
  ],
  [
    "family unary unused",
    "function unused(a:float32|float64){~a;}"
  ],
  [
    "family unary executed",
    "function unused(a:float32|float64){~a;} unused(float32(1));"
  ],
  [
    "family binary unused",
    "function unused(a:float32|float64,b:float32|float64){a&b;}"
  ],
  [
    "family binary executed",
    "function unused(a:float32|float64,b:float32|float64){a&b;} unused(float32(1),float32(2));"
  ],
  [
    "one union arithmetic existing",
    "function unused(a:uint8|int8,b:uint16){a*b;}"
  ],
  [
    "one numeric existing",
    "function unused(a:uint8,b:uint16){a*b;}"
  ],
  [
    "one family existing",
    "function unused(a:float32){~a;}"
  ]
])('R27 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "overlap runtime",
    "function unused(a:uint8|int8,b:uint8|uint16){a*b;} unused(int8(1),uint16(2));"
  ]
])('R27 retains runtime failure: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "overlap",
    "function unused(a:uint8|int8,b:uint8|uint16){a*b;} unused(uint8(1),uint8(2));"
  ],
  [
    "literal context",
    "function unused(a:uint8|int8){a*2;} unused(uint8(1));"
  ],
  [
    "dynamic",
    "function unused(a:any,b:uint16){a*b;} unused(uint16(1),uint16(2));"
  ],
  [
    "class operators",
    "class A{operator*(x:uint16):uint8{return 1;}} class B{operator*(x:uint16):uint8{return 1;}} function unused(a:A|B,b:uint16){a*b;} unused(new A(),uint16(1));"
  ]
])('R27 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "parenthesized bitwise",
    "function f(x:float32|float64,y:float32|float64){(x)&(y);}"
  ]
])('R27 boundary control (early): %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "literal adoption",
    "function f(x:uint8|int8){x*1;}f(uint8(2));"
  ],
  [
    "class union arithmetic",
    "class C{operator*(x:uint16):uint16{return x;}}function f(x:C|uint8,y:uint16){x*y;}f(new C(),uint16(2));"
  ],
  [
    "class union bitwise",
    "class C{operator&(x:float32):float32{return x;}}function f(x:C|uint8,y:float32){x&y;}f(new C(),float32(2));"
  ],
  [
    "derived union comparison",
    "class C{operator<(x:complex):boolean{return true;}}function f(x:C|uint8,y:complex){x>=y;}f(new C(),1i);"
  ],
  [
    "unary union overload",
    "class C{operator~():number{return 1;}}function f(x:C|float32){~x;}f(new C());"
  ],
  [
    "rational exponent union",
    "function f(x:rational,y:uint8|int8){x**y;}f(rational(2),uint8(2));"
  ]
])('R27 boundary control (ok): %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each(['x * 300', '300 * x', 'x & 1'])('each union literal context is checked without committing failed alternatives: %s', (expression) => {
  const type = expression.includes('&') ? 'float32 | float64' : 'uint8 | int8';
  expectStaticTypeError(`function f(x:${type}){${expression};}`);
});
