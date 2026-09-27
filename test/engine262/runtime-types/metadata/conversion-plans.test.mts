import { expect, test } from 'vitest';
import { evaluated, expectThrown, expectStaticTypeError } from '../harness.mts';

const units = (ratio = 'float64', base = 'float64') => `
type Dim = { m: int32, ratio: ${ratio} };
meta Dim {
  default = { m: 0, ratio: 1 };
  subtype(a: Dim, b: Dim): boolean { return a.m === b.m; }
  conversionFactor(a: Dim, b: Dim): ${ratio} { return a.ratio / b.ratio; }
}
type M = ${base}.<{ m: 1, ratio: 1 }>;
type KM = ${base}.<{ m: 1, ratio: 1000 }>;
type CM = ${base}.<{ m: 1, ratio: 0.01 }>;
`;
const addition = `primitive float64<const D: Dim> {
  operator +(rhs: float64.<D>): float64.<D> { return this + rhs; }
}`;

test.each([false, true])('typed hooks convert a boundary (rational=%s)', (rational) => {
  expect(evaluated(`${units(rational ? 'rational64' : 'float64')}
    let m: M = (1 := KM); String(m);`)).toBe('1000');
});

test('rational scaling does not round a wide integer through Number', () => {
  expect(evaluated(`${units('rational64', 'uint64')}
    let m: M = (9007199254741 := KM); String(m);`)).toBe('9007199254741000');
});

test('invalid factors fail the crossing', () => {
  expectThrown(`type D = { r: number }; meta D { default = { r: 1 };
    subtype(a, b) { return true; } conversionFactor(a, b) { return 'invalid'; } }
    type A = float64.<{ r: 2 }>; type B = float64.<{ r: 3 }>;
    let b: B = (1 := A);`, 'conversionFactor');
});

test('operator arguments convert before the raw body in both directions', () => {
  expect(evaluated(`${units()} ${addition}
    const a = (1 := M) + (1 := KM); const b = (1 := KM) + (1 := M);
    String(a) + '/' + String(b) + '/' + String(Reflect.typeOf(a) === M) + '/' + String(Reflect.typeOf(b) === KM);`)).toBe('1001/1.001/true/true');
});

test.each([false, true])('exact metadata resolves an otherwise tied operand (reverse=%s)', (reverse) => {
  const defs = [
    `operator +(rhs: float64.<D>): string { return 'converted'; }`,
    `operator +(rhs: KM): string { return 'exact'; }`,
  ];
  expect(evaluated(`${units()} primitive float64<const D: Dim> { ${reverse ? defs.reverse().join(' ') : defs.join(' ')} }
    (1 := M) + (1 := KM);`)).toBe('exact');
});

test('strict specificity precedes a broad conversion-free fallback', () => {
  expect(evaluated(`${units()} primitive float64<const D: Dim> {
    operator +(rhs: float64): string { return 'broad'; }
    operator +(rhs: float64.<D>): string { return 'specific'; }
  } (1 := M) + (1 := KM);`)).toBe('specific');
});

test('two converting targets remain ambiguous', () => {
  expectThrown(`${units()} primitive float64<const D: Dim> {
    operator +(rhs: M): string { return 'm'; }
    operator +(rhs: CM): string { return 'cm'; }
  } function f(a: any, b: any) { return a + b; } f(1 := M, 1 := KM);`, 'ambiguous');
});

test('bodyless metadata builders observe rescaled operand bounds', () => {
  expect(evaluated(`${units()} ${addition}
    type Bound = { hi: number };
    meta Bound { default = { hi: 0 }; subtype(a, b) { return a.hi <= b.hi; }
      rescale(a, f) { return { hi: a.hi * f }; } }
    function sum(a: Bound, b: Bound): Bound { return { hi: a.hi + b.hi }; }
    primitive float64<const B: Bound> {
      operator +.<B2: Bound>(rhs: float64.<B2>): float64.<sum(B, B2)>;
    }
    const a = (1 := float64.<{ m: 1, ratio: 1000, hi: 1 }>);
    const b = (500 := float64.<{ m: 1, ratio: 1, hi: 500 }>);
    const c = a + b;
    String(c) + '/' + String(Reflect.typeOf(c));`)).toBe('1.5/float64.<{ m: 1, ratio: 1000, hi: 1.5 }>');
});

test('identity-factor conversion transports an unpinned portion', () => {
  expect(evaluated(`${units()} type Bound = { hi: number };
    meta Bound { default = { hi: 0 }; subtype(a, b) { return true; } }
    let m: M = (1 := float64.<{ m: 1, ratio: 1, hi: 8 }>);
    String(Reflect.typeOf(m));`)).toBe('float64.<{ m: 1, ratio: 1, hi: 8 }>');
});

test('unit conversion does not convert a reference location', () => {
  expectStaticTypeError(`${units()} function f(ref x: M) { x = (2 := M); }
    let km: KM = (1 := KM); f(ref km);`);
});

test('a failed compound conversion leaves its location unchanged', () => {
  expect(evaluated(`${units()} ${addition} let x: M = (1 := M);
    function f(ref x: M, y: any) { x += y; }
    try { f(ref x, 1 := float64.<{ m: 2, ratio: 1 }>); } catch (e) {}
    String(x);`)).toBe('1');
});

test('original operands evaluate once and a conversion quantizes once', () => {
  expect(evaluated(`type D={r:number}; meta D {default={r:1};subtype(a,b){return true;}
    conversionFactor(a,b){return a.r/b.r;} quantize(v,c){return v+(1:=float64);}}
    type A=float64.<{r:2}>;type B=float64.<{r:3}>;
    primitive float64<const X:D>{operator +(rhs:float64.<X>):float64.<X>{return this+rhs;}}
    let reads=0;function read():B {reads+=1;return 2:=B;}
    const x=(1:=A)+read(); String(x)+'/'+String(reads);`)).toBe('5/1');
});

test('an explicit default stays pinned while an untransportable portion is dropped', () => {
  expect(evaluated(`type D={r:number};meta D {default={r:1};subtype(a,b){return true;}conversionFactor(a,b){return a.r/b.r;}}
    type B={hi:number};meta B {default={hi:0};subtype(a,b){return true;}}
    let x:float64.<{r:1}>=(2:=float64.<{r:3,hi:8}>);
    String(x)+'/'+String(Reflect.typeOf(x));`)).toBe('6/float64.<{ r: 1 }>');
});

test('bodyless definitions share the converted operand without a value body', () => {
  expect(evaluated(`${units()} primitive float64<const D:Dim>{operator +(rhs:float64.<D>):float64.<D>;}
    type Bound={hi:number};meta Bound {default={hi:0};subtype(a,b){return true;}rescale(a,f){return {hi:a.hi*f};}}
    function sum(a:Bound,b:Bound):Bound{return {hi:a.hi+b.hi};}
    primitive float64<const B:Bound>{operator +.<C:Bound>(rhs:float64.<C>):float64.<sum(B,C)>;}
    const x=(1:=float64.<{m:1,ratio:1000,hi:1}>)+(500:=float64.<{m:1,ratio:1,hi:500}>);
    String(x)+'/'+String(Reflect.typeOf(x));`)).toBe('1.5/float64.<{ m: 1, ratio: 1000, hi: 1.5 }>');
});

test('conflicting bodyless conversion requirements are ambiguous', () => {
  expectThrown(`${units()} primitive float64<const D:Dim>{operator +(rhs:M):M;operator +(rhs:CM):CM;}
    function f(a:any,b:any){return a+b;} f(1:=M,2:=KM);`, 'incompatible operand conversion');
});

test('quantization cannot leave a falsely carried bound', () => {
  expectThrown(`type D={r:number};meta D {default={r:1};subtype(a,b){return true;}
    quantize(v,c){return v+(1:=float64);}}
    type B={hi:number};meta B {default={hi:0};subtype(a,b){return true;}validate(v,c){return Number(v)<=c.hi;}}
    let x:float64.<{r:2}>=(2:=float64.<{r:3,hi:2}>);`);
});

test('invalid rescale and quantize results fail instead of disappearing', () => {
  expectThrown(`${units()} type B={hi:number};meta B {default={hi:0};subtype(a,b){return true;}rescale(a,f){return 'bad';}}
    let x:M=(1:=float64.<{m:1,ratio:1000,hi:8}>);`, 'rescale');
  expectThrown(`type D={r:number};meta D {default={r:1};subtype(a,b){return true;}quantize(v,c){return 'bad';}}
    let x:float64.<{r:2}>=(1:=float64.<{r:3}>);`, 'quantize');
});

test('a rational factor scales wide range endpoints without a Number round trip', () => {
  expect(evaluated(`const bounds=(9007199254741:=uint64)..=(9007199254742:=uint64);
    const scaled=bounds.scale(rational64(1000,1));String(scaled.start)+'/'+String(scaled.end);`)).toBe('9007199254741000/9007199254742000');
});


test('exact factor products do not acquire the default rational width bound', () => {
  expect(evaluated(`type D={r:number};meta D {default={r:1};subtype(a,b){return true;}
    conversionFactor(a,b){return 18446744073709551616n;}}
    let x:uint128.<{r:2}>=(1:=uint128.<{r:3}>);String(x);`)).toBe('18446744073709551616');
});


for (const [factor, presentation, scaled] of [
  ['4', 'number', '4'],
  ['rational64(4)', 'rational64', '4'],
  ['18446744073709551616n', 'rational.<bigint>', '18446744073709551616'],
]) {
  test(`typed rescale observes the explicit ${presentation} factor presentation`, () => {
    expect(evaluated(`type Units = { u: number }; meta Units { default = { u: 0 }; subtype(a,b) { return true; }
      conversionFactor(a,b) { return ${factor}; } }
      type Seen = { presentation: string }; meta Seen { default = { presentation: "none" }; subtype(a,b) { return true; }
      rescale(c: Seen, factor: number | rational64 | rational.<bigint>): Seen { return { presentation: String(Reflect.typeOf(factor)) }; } }
      type Source = uint128.<{ u: 1, presentation: "source" }>; type Target = uint128.<{ u: 2 }>;
      const x: Target = Source(1); String(x) + '/' + Reflect.getReflection(Reflect.typeOf(x)).metadata.presentation;`)).toBe(`${scaled}/${presentation}`);
  });
}
