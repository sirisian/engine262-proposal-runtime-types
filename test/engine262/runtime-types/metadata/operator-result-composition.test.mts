import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const dimensions = `type Dim = { m: int32, ratio: rational64 };
  meta Dim { default = { m: 0, ratio: 1 }; subtype(a: Dim, b: Dim): boolean { return a.m === b.m; } }
  type M = float32.<{ m: 1 }>;
  const a = 2 := M; const b = 3 := M;`;
const definition = (metadata: string, body = false) => `primitive float32<const D: Dim> {
  operator +(rhs: float32.<D>): float32.<${metadata}> ${body ? '{ return this + rhs; }' : ';'} }`;

for (const reverse of [false, true]) {
  test(`value and bodyless result conflicts are errors (reverse=${reverse})`, () => {
    const blocks = [definition('{m:1}', true), definition('{m:2}')];
    if (reverse) blocks.reverse();
    expectThrown(`${dimensions} ${blocks.join('\n')} a + b;`, 'conflicting operator result metadata for Dim');
  });

  test(`bodyless result conflicts are errors (reverse=${reverse})`, () => {
    const blocks = [definition('{m:1}'), definition('{m:2}')];
    if (reverse) blocks.reverse();
    expectThrown(`${dimensions} ${blocks.join('\n')} a + b;`, 'conflicting operator result metadata for Dim');
  });

  test(`equivalent completed bodyless portions are accepted (reverse=${reverse})`, () => {
    const blocks = [definition('{m:2}'), definition('{m:2,ratio:1}')];
    if (reverse) blocks.reverse();
    expect(evaluated(`${dimensions} ${blocks.join('\n')} const result = a + b;
      String(result) + '/' + String(Reflect.typeOf(result) === float32.<{m:2,ratio:1}>);`)).toBe('5/true');
  });
}

test('a conflict is checked before the value body and before a compound store', () => {
  const body = definition('{m:1}', true).replace('return this + rhs;', 'calls += 1; return this + rhs;');
  expect(evaluated(`${dimensions} let calls=0; ${body} ${definition('{m:2}')}
    let destination: M = a; let caught=false;
    try { destination += b; } catch (e) { caught=true; }
    String(caught)+'/'+String(calls)+'/'+String(destination);`)).toBe('true/0/2');
});

test('a fixed value definition contributes its written metadata', () => {
  expectThrown(`${dimensions} primitive float32 { operator +(rhs:M):M { return this+rhs; } }
    ${definition('{m:2}')} a+b;`, 'conflicting operator result metadata for Dim');
});

test('equivalent value and bodyless contributions agree', () => {
  expect(evaluated(`${dimensions} ${definition('{m:1}', true)} ${definition('{m:1,ratio:1}')}
    const result:any=a+b; String(result)+'/'+String(Reflect.typeOf(result) === float32.<{m:1,ratio:1}>);`)).toBe('5/true');
});

test('independent portions compose with a value definition', () => {
  expect(evaluated(`${dimensions} type Bounds={lo:int32};
    meta Bounds {default={lo:0};subtype(a,b){return true;}}
    ${definition('{m:1}', true)} primitive float32<const B:Bounds> {
      operator +(rhs:float32):float32.<{lo:2}>; }
    const result:any=a+b; String(result)+'/'+String(Reflect.typeOf(result) === float32.<{m:1,ratio:1,lo:2}>);`)).toBe('5/true');
});

for (const reverse of [false, true]) {
  test(`vector lane result conflicts are errors (reverse=${reverse})`, () => {
    const block = (m: number) => `primitive vector<float32.<const D:Dim>,const N:uint32> {
      operator +(rhs:vector.<float32.<D>,N>):vector.<float32.<{m:${m}}>,N>; }`;
    const blocks=[block(1),block(2)]; if (reverse) blocks.reverse();
    expectThrown(`${dimensions} ${blocks.join('\n')}
      const v=vector.<M,2>(a,b); v+v;`, 'conflicting operator result metadata for Dim');
  });
}

test('dimension mismatch diagnostics name the meta type without changing admission', () => {
  expectThrown(`${dimensions} ${definition('{m:1}', true)} a+3;`, 'differing Dim metadata');
  expectThrown(`${dimensions} ${definition('{m:1}', true)} const scalar:float32=3; a+scalar;`, 'Dim');
});


test('bodyless conflicts cannot be hidden by an unannotated value definition', () => {
  expectThrown(`${dimensions} primitive float32<const D:Dim> {
      operator +(rhs:float32.<D>) {return this+rhs;} }
    ${definition('{m:1}')} ${definition('{m:2}')} a+b;`, 'conflicting operator result metadata for Dim');
});

test('independent bodyless vector portions merge into every lane', () => {
  expect(evaluated(`${dimensions} type Bounds={lo:int32};
    meta Bounds {default={lo:0};subtype(a,b){return true;}}
    primitive vector<float32.<const D:Dim>,const N:uint32> {
      operator +(rhs:vector.<float32.<D>,N>):vector.<float32.<{m:2}>,N>; }
    primitive vector<float32.<const B:Bounds>,const N:uint32> {
      operator +(rhs:vector.<float32.<B>,N>):vector.<float32.<{lo:4}>,N>; }
    const v=vector.<M,2>(a,b);const result:any=v+v;
    type Expected=float32.<{m:2,ratio:1,lo:4}>;
    String(result)+'/'+String(Reflect.typeOf(result.x)===Expected)+'/'+String(Reflect.typeOf(result)===vector.<Expected,2>);`)).toBe('(4, 6)/true/true');
});
