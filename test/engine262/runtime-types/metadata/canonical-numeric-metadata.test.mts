import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

test.each(['int32', 'int64', 'uint64', 'float32', 'float64', 'float128', 'rational64', 'decimal128'])('all metadata origins agree for %s', (field) => {
  expect(evaluated(`type D = { n: ${field} }; meta D { default = { n: 0 };
    subtype(a: D, b: D): boolean { return a.n === b.n; } }
    function builder(): D { return { n: 1 }; }
    type A = float32.<{ n: 1 }>; type B = float32.<builder()>;
    const reflected = Reflect.makeType({ kind: 'parameterized', base: float32, metadata: { n: 1 } });
    String(A === B) + '/' + String(A === reflected) + '/' + String(Reflect.makeType(Reflect.getReflection(A)) === A)
      + '/' + String((2 := float32) is float32.<{ n: 0 }>);`)).toBe('true/true/true/true');
});

test('normalization does not wrap an out-of-range integer', () => {
  expectThrown(`type D = { n: uint8 }; meta D { default = { n: 0 }; subtype(a,b) { return true; } }
    type Bad = float32.<{ n: 256 }>; const value = 1 := Bad;`, 'shape');
  expectThrown(`type D = { n: uint8 }; meta D { default = { n: 0 }; subtype(a,b) { return true; } }
    Reflect.makeType({kind: 'parameterized', base: float32, metadata: { n: 256 }});`, 'shape');
});

test('nested records, tuples and optional numeric leaves normalize recursively', () => {
  expect(evaluated(`type D = { data: { pair: [int64, rational64], option: int32 | undefined } };
    meta D { default = { data: { pair: [0, 1], option: 0 } }; subtype(a,b) { return true; } }
    type A = float32.<{ data: { pair: [1, 2], option: 3 } }>;
    function builder(): D { return { data: { pair: [1, 2], option: 3 } }; }
    type B = float32.<builder()>; String(A === B);`)).toBe('true');
});

test('normalization preserves signed zero and wide integer identity', () => {
  expect(evaluated(`type D = { n: float64 }; meta D { default = { n: 0 }; subtype(a,b) { return true; } }
    String(float32.<{ n: 0 }> === float32.<{ n: -0 }>);`)).toBe('false');
  expect(evaluated(`type D = { n: uint64 }; meta D { default = { n: 0 }; subtype(a,b) { return true; } }
    const a = Reflect.makeType({kind:'parameterized', base:float32, metadata:{n:9007199254740992n}});
    const b = Reflect.makeType({kind:'parameterized', base:float32, metadata:{n:9007199254740993n}});
    String(a === b) + '/' + String(Reflect.makeType(Reflect.getReflection(b)) === b);`)).toBe('false/true');
});


test.each([
  ['uint64', '9007199254740993'], ['int64', '-9007199254740993'],
  ['rational64', '0.1'], ['decimal128', '0.1000000000000000000000000000000001'],
  ['float128', '0.1'], ['uint64', '0x20000000000001'], ['decimal128', '0.00'],
])('written %s metadata keeps its exact source digits (%s)', (field, literal) => {
  expect(evaluated(`type D = { n: ${field} }; meta D { default = { n: 0 }; subtype(a,b) { return true; } }
    type A = float32.<{ n: ${literal} }>;
    function builder(): D { return { n: ${literal} }; }
    type B = float32.<builder()>; String(A === B)
      + '/' + String(Reflect.makeType(Reflect.getReflection(A)) === B);`)).toBe('true/true');
});

test.each(['0..<10', '0..=10', '0<..<10', '0<..=10', '0..', '0<..', '..<10', '..=10', '..'])('range metadata reflection preserves identity for %s', (bounds) => {
  expect(evaluated(`type Bounds={bounds:RangeBounds.<any>};meta Bounds {default={bounds:..};subtype(a,b){return true;}}
    type T=float64.<{bounds:${bounds}}>;
    String(Reflect.makeType(Reflect.getReflection(T))===T);`)).toBe('true');
});

test('range metadata still checks its declared shape', () => {
  expectThrown(`type Bounds={bounds?:Range.<any>};meta Bounds {default={};subtype(a,b){return true;}}
    type T=float64.<{bounds:0..}>;`, 'shape');
});

test('reflection preserves an explicit default requirement as a distinct type', () => {
  expect(evaluated(`type Dim={m:int32};meta Dim {default={m:0};subtype(a,b){return a.m===b.m;}}
    type Zero=float64.<{m:0}>;
    String(Reflect.makeType(Reflect.getReflection(Zero))===Zero)+'/'+String(Zero===float64);`)).toBe('true/false');
});

test('integral rational metadata uses the ordinary rational display', () => {
  expect(evaluated(`type Dim={ratio:rational64};meta Dim {default={ratio:1};subtype(a,b){return true;}}
    type T=float64.<{ratio:10}>;
    String(T)+'/'+String(rational64(10));`)).toBe('float64.<{ ratio: 10 }>/10');
});
