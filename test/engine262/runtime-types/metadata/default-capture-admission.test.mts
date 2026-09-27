import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const dim = (field = 'int32') => `type Dim = { m: ${field} };
  meta Dim { default = { m: 0 }; subtype(a: Dim, b: Dim): boolean { return a.m === b.m; } }
  type Scalar = float32.<{ m: 0 }>; type Meter = float32.<{ m: 1 }>;`;

test.each(['number', 'int32'])('default admission agrees at value boundaries (%s)', (field) => {
  const prelude = dim(field);
  expect(evaluated(`${prelude} const p = (2 := float32); let s: Scalar = p;
    function f(x: Scalar): Scalar { return x; }
    String(Reflect.typeOf(f(s))) + '/' + String(Scalar === float32);`)).toBe('float32/false');
  expect(evaluated(`${prelude} function f(): Scalar { return 2 := float32; }
    String(Reflect.typeOf(f()));`)).toBe('float32');
  expect(evaluated(`${prelude} String((2 := float32) is Scalar) + '/' + String((2 := Meter) is Scalar);`)).toBe('true/false');
});

test.each(['number', 'int32'])('default admission inspects metadata before erasure (%s)', (field) => {
  const prelude = dim(field);
  for (const source of ['(2 := Meter)', 'p']) {
    expectThrown(`${prelude} const p: float32 = (2 := Meter); function f(x: Scalar) { return 0; }
      const g: any = f; g(${source});`, 'does not admit');
  }
});

test('value admission does not convert a borrowed location', () => {
  expectThrown(`${dim()} function f(ref x: Scalar) { x = (3 := Scalar); }
    let p: float32 = 2; f(ref p);`, 'ref');
  expectThrown(`${dim()} function f(ref x: Scalar) { x = (3 := Scalar); }
    const g: any = f; let p: float32 = 2; g(ref p);`);
});

test.each([
  ['float32', '', '(2 := float32)'],
  ['uint', '<const W>', '(2 := uint16)'],
  ['complex', '<const E>', 'complex128(1, 2)'],
  ['rational', '<const W>', 'rational64(1, 2)'],
  ['decimal128', '', 'decimal128(2)'],
])('a %s capture reads the default on a mixed operation', (family, components, receiver) => {
  expect(evaluated(`${dim()} primitive ${family}${components}<const D: Dim> {
    operator *(rhs: string): string { return String(D.m); }
  } ${receiver} * 'read';`)).toBe('0');
});

test('another metadata type does not change the Dim projection', () => {
  expect(evaluated(`${dim()} type B = { lo: number };
    meta B { default = { lo: 0 }; subtype(a, b) { return a.lo === b.lo; } }
    primitive float32<const D: Dim> { operator *(rhs: string): string { return String(D.m); } }
    ((2 := float32) * 'read') + '/' + ((2 := float32.<{ lo: 1 }>) * 'read');`)).toBe('0/0');
});

test.each([false, true])('generic multiplication admits a scalar (reverse=%s)', (reverse) => {
  const a = reverse ? '(3 := Meter)' : '(2 := float32)';
  const b = reverse ? '(2 := float32)' : '(3 := Meter)';
  expect(evaluated(`${dim()} function mul(a: Dim, b: Dim): Dim { return { m: a.m + b.m }; }
    primitive float32<const D: Dim> {
      operator *.<R: Dim>(rhs: float32.<R>): float32.<mul(D, R)>;
    }
    const v = ${a} * ${b}; String(v) + '/' + String(Reflect.typeOf(v));`)).toBe('6/float32.<{ m: 1 }>');
});

test('ordinary arithmetic does not invoke a default-bound value body', () => {
  expect(evaluated(`${dim()} primitive float32<const D: Dim> {
    operator +(rhs: float32.<D>): float32.<D> { return this - rhs; }
    operator -(): float32.<D> { return this; }
  }
  let x: float32 = 2; x += (3 := float32);
  String(x) + '/' + String(-(2 := float32));`)).toBe('5/-2');
});

test('a metadata specialization can match the plain type', () => {
  expect(evaluated(`${dim()} function f<float32.<const D: Dim>>(): int32 { return D.m; }
    String(f.<float32>());`)).toBe('0');
});

test('a bodyless declaration cannot brand ordinary plain arithmetic', () => {
  expect(evaluated(`${dim()} primitive float32<const D: Dim> {
    operator +(rhs: float32.<D>): Meter;
  } const v = (2 := float32) + (3 := float32);
  String(v) + '/' + String(Reflect.typeOf(v));`)).toBe('5/float32');
});

test('a default-typed location can still be borrowed through any', () => {
  expect(evaluated(`${dim()} function f(ref x: Scalar) { x = (3 := float32); }
    const g: any = f; let s: Scalar = (2 := float32); g(ref s); String(s);`)).toBe('3');
});

test('int64 defaults and written numeric leaves normalize alike', () => {
  expect(evaluated(`${dim('int64')} let s: Scalar = (2 := float32);
    String(Reflect.typeOf(s));`)).toBe('float32');
});

test('operator admission uses subtype rather than repeated-capture equality', () => {
  expect(evaluated(`type Bound = { hi: number };
    meta Bound { default = { hi: 100 }; subtype(a: Bound, b: Bound): boolean { return a.hi <= b.hi; } }
    primitive float32<const D: Bound> { operator *(rhs: float32.<D>): string { return 'admitted'; } }
    function f(a: any, b: any): string { return a * b; }
    f(2 := float32.<{ hi: 5 }>, 3 := float32.<{ hi: 3 }>);`)).toBe('admitted');
});

test('a default capture remains a value of its declared domain', () => {
  expect(evaluated(`${dim()} primitive float32<const D: Dim> {
    operator *(rhs: string): string { return String(D is Dim); }
  } (2 := float32) * 'read';`)).toBe('true');
});

test('a vector lane capture reads a domain-typed default', () => {
  expect(evaluated(`${dim()} primitive vector<float32.<const D: Dim>, const N: uint32> {
    operator *(rhs: string): string { return String(D is Dim) + '/' + String(D.m); }
  } float32x4(1, 2, 3, 4) * 'read';`)).toBe('true/0');
});

test('cancellation produces a plain result without collapsing the default Type Object', () => {
  expect(evaluated(`${dim()} function mul(a: Dim, b: Dim): Dim { return { m: a.m + b.m }; }
    primitive float32<const D: Dim> {
      operator *.<R: Dim>(rhs: float32.<R>): float32.<mul(D, R)>;
    }
    const v = (2 := Meter) * (3 := float32.<{ m: -1 }>);
    String(v) + '/' + String(Reflect.typeOf(v)) + '/' + String(Scalar === float32);`)).toBe('6/float32/false');
});
