import { expect, test } from 'vitest';
import { evaluated, expectThrownKind, observeScript } from '../harness.mts';

const make = (predicate: string, base = 'number') => `Reflect.makeType({kind:'parameterized',base:${base},metadata:{where:${predicate}}})`;

test('same callback and base intern to the same Type Object', () => {
  expect(evaluated(`const p=x=>x>0;const A=${make('p')};const B=${make('p')};String(A===B);`)).toBe('true');
});

test('fresh callbacks with identical text retain distinct identities', () => {
  expect(evaluated(`const A=${make('x=>x>0')};const B=${make('x=>x>0')};String(A===B);`)).toBe('false');
});

test('repeated builder calls cannot reuse a freshly allocated predicate', () => {
  expect(evaluated(`function make(){return ${make('x=>x>0')};}const A=make(),B=make();String(A===B);`)).toBe('false');
});

test('an impossible predicate is a valid distinct refinement', () => {
  expect(evaluated(`type Triple=[uint8,uint8,uint8];const T=${make('x=>x.length===2','Triple')}; String(T===never)+','+String([1,2,3] is T);`)).toBe('false,false');
});

test('refinement of never retains callback identity in reflection', () => {
  expect(evaluated(`const p=x=>true;const T=${make('p','never')};String(T===never)+','+String(Reflect.getReflection(T).metadata.where===p);`)).toBe('false,true');
});

test.each(['number','string','boolean','any','[number,number]','{x:number}'])('round trips a predicate over %s', (base) => {
  expect(evaluated(`type Base=${base};const p=x=>true;const T=${make('p','Base')};String(Reflect.makeType(Reflect.getReflection(T))===T);`)).toBe('true');
});

test.each([
  ['number','0','x=>x===0','0'], ['string','""','x=>x.length===0',''], ['boolean','false','x=>!x','false'],
  ['uint8','0','x=>x>=0','0'], ['[uint8,uint8]','[0,0]','x=>x.length===2','0,0'],
])('accepts a valid default for %s', (base, _unused, predicate, expected) => {
  expect(evaluated(`type Base=${base};const p=${predicate};const T=${make('p','Base')};let value:T;String(value);`)).toBe(expected);
});

test.each(['number','string','boolean','uint8','[uint8,uint8]','{x:number}'])('a false predicate removes the default for %s', (base) => {
  expectThrownKind(`type Base=${base};const p=x=>false;const T=${make('p','Base')};let value:T;`, 'TypeError');
});

test('a default predicate throw is propagated instead of reported as missing', () => {
  expect(evaluated(`const p=x=>{throw 'default-predicate';};const T=${make('p')};try{let value:T;}catch(e){e;}`)).toBe('default-predicate');
});

test('nested refinements preserve base-first order and short circuit', () => {
  expect(evaluated(`let log='';const candidate={get a(){log+='a';return 0;},get b(){log+='b';return 1;}};const A=${make('x=>x.a>0','any')};const B=${make('x=>x.b>0','A')};candidate is B;log;`)).toBe('a');
});

test('nested successful refinements run in base-first order', () => {
  expect(evaluated(`let log='';const candidate={get a(){log+='a';return 1;},get b(){log+='b';return 1;}};const A=${make('x=>x.a>0','any')};const B=${make('x=>x.b>0','A')};candidate is B;log;`)).toBe('ab');
});

test.each([
  ['union','[{type:A},{type:string}]','true,true,false'],
  ['intersection','[{type:A},{type:number}]','true,false,false'],
])('composes with %s', (kind, _unused, expected) => {
  expect(evaluated(`const A=${make('x=>x>0')};const T=Reflect.makeType({kind:'${kind}',members:[A,${kind==='union'?'string':'number'}]});String(1 is T)+','+String('x' is T)+','+String(-1 is T);`)).toBe(expected);
});

test('a refined value remains assignable to its base', () => {
  expect(evaluated(`const p=x=>x>0;const T=${make('p')};String(Reflect.isAssignable(T,number))+','+String(Reflect.isAssignable(number,T));`)).toBe('true,false');
});

test('different predicates do not imply one another by executing sample values', () => {
  expect(evaluated(`const A=${make('x=>x>0')};const B=${make('x=>x>1')};String(Reflect.isAssignable(A,B))+','+String(Reflect.isAssignable(B,A));`)).toBe('false,false');
});

test('source where is reflected as an ordinary parameterized type', () => {
  expect(evaluated(`type Positive=number where this>0;const node=Reflect.getReflection(Positive);String(node.kind)+','+String(node.base===number)+','+String(node.metadata.where(1))+','+String(node.metadata.where(-1));`)).toBe('parameterized,true,true,false');
});

test('multiple source clauses lower to nested parameterizations', () => {
  expect(evaluated(`type Bounded=number where this>0 where this<10;const node=Reflect.getReflection(Bounded);String(node.kind)+','+String(Reflect.getReflection(node.base).kind)+','+String(5 is Bounded)+','+String(11 is Bounded);`)).toBe('parameterized,parameterized,true,false');
});

test('source reflection reconstruction retains the source callback', () => {
  expect(evaluated(`type Positive=number where this>0;String(Reflect.makeType(Reflect.getReflection(Positive))===Positive);`)).toBe('true');
});

test('source clauses retain the declaring activation after return', () => {
  expect(evaluated(`function make(limit){type Below=number where this<limit;return Below;}const A=make(5),B=make(10);String(7 is A)+','+String(7 is B)+','+String(A===B);`)).toBe('false,true,false');
});

test('source generic value parameters are converted and captured', () => {
  expect(evaluated(`type Below<N:uint32>=uint32 where this<N;String((5:=uint32) is Below.<10>)+','+String((15:=uint32) is Below.<10>)+','+String((15:=uint32) is Below.<20>);`)).toBe('true,false,true');
});

test('repeating one source generic specialization retains identity', () => {
  expect(evaluated(`type Below<N:uint32>=uint32 where this<N;String((type Below.<10>)===(type Below.<10>))+','+String((type Below.<10>)===(type Below.<20>));`)).toBe('true,false');
});

test.each(['uint8','int16','uint32','float32','float64'])('numeric literals convert before %s refinement validation', (base) => {
  expect(evaluated(`type Positive=${base} where this>0;let value:Positive=2;String(value);`)).toBe('2');
  expect(observeScript(`type Positive=${base} where this>0;const input:any=0;let value:Positive=input;`).completion.Type).toBe('throw');
});

test('an object literal receives numeric context through where metadata', () => {
  expect(evaluated(`type Positive={value:uint8} where this.value>0;let result:Positive={value:2};String(result.value);`)).toBe('2');
});

test('source clauses use the same stable-capture admission as builders', () => {
  expectThrownKind('const state={limit:0};type Positive=number where this>state.limit;', 'TypeError');
});

test('source predicate captures cannot be reset by repeated reflection', () => {
  expect(evaluated(`function make(limit){type Positive=number where this>limit;limit=9;try{Reflect.makeType(Reflect.getReflection(Positive));}catch(e){return String(e instanceof TypeError);}return 'wrong';}make(2);`)).toBe('true');
});

test('where inside a generic builder retains the type-parameter value', () => {
  expect(evaluated(`function build<T:type>(){const p=x=>x is T;return ${make('p','any')};}const A=build.<string>(),B=build.<number>();String('s' is A)+','+String('s' is B);`)).toBe('true,false');
});

test('predicate default throws propagate through nested refinements', () => {
  expect(evaluated(`const A=${make("x=>{throw 'inner';}")};const B=${make('x=>x>=0','A')};try{let value:B;}catch(e){e;}`)).toBe('inner');
});

test('type-position builder calls retain fresh predicate identities', () => {
  expect(evaluated(`function make(){return ${make('x=>x>0')};}type A=make();type B=make();String(A===B);`)).toBe('false');
});

test('type-position builder calls can reuse a retained predicate identity', () => {
  expect(evaluated(`const p=x=>x>0;function make(){return ${make('p')};}type A=make();type B=make();String(A===B);`)).toBe('true');
});

test.each(['value-1','value*0','value&0','value>>1','value^1','-value'])('arithmetic does not promise the input predicate: %s', (expression) => {
  expect(evaluated(`const T=${make('x=>x>0','uint8')};let value:T=1;const result=${expression};String(Reflect.typeOf(result)===uint8);`)).toBe('true');
});

test('an updating operator must cross the refined destination again', () => {
  expectThrownKind(`const T=${make('x=>x<2','uint8')};let value:T=1;value++;`, 'TypeError');
});

test('a predicate does not grant an unrelated metadata brand', () => {
  expectThrownKind(`type Unit={unit:string};meta Unit{default={unit:''};subtype(a,b){return a.unit===b.unit;}}const T=Reflect.makeType({kind:'parameterized',base:uint8,metadata:{unit:'m',where:x=>true}});const input:any=1;let value:T=input;`, 'TypeError');
});

test('a caught inner predicate throw does not turn false into an abrupt default', () => {
  const result=evaluated(`const Inner=${make("x=>{throw 'caught';}")};const T=${make('x=>{try{x is Inner;}catch{}return false;}')};try{let value:T;}catch(e){String(e);}`);
  expect(result).toContain('no default');
  expect(result).not.toContain('caught');
});

test('a recursive generic alias enforces its refinement at nested occurrences', () => {
  expect(evaluated('type Node<N:number>={value:number,next:[].<Node.<N>>} where this.value>N;const bad:any={value:1,next:[{value:-1,next:[]}]};const good:any={value:1,next:[{value:2,next:[]}]};String(bad is Node.<0>)+","+String(good is Node.<0>);')).toBe('false,true');
});

test('a generic specialization condition remains separate from its value refinement', () => {
  expect(evaluated('type A<N:number>=number where N>0 where this>N;String(3 is A.<2>)+","+String(1 is A.<2>);')).toBe('true,false');
  expect(observeScript('type A<N:number>=number where N>0 where this>N;A.<-1>;').completion.Type).toBe('throw');
});

test('a where wrapper does not make a self-only generic alias productive', () => {
  expect(observeScript('type A<T:type>=A.<T> where this is T;A.<number>;').completion.Type).toBe('throw');
});


test.each(['uint8','uint32','float64','[uint8,uint16]'])('a refinement retains the complete layout of %s', (base) => {
  expect(evaluated(`type Base=${base};const T=${make('x=>true','Base')};String(T.hasLayout===Base.hasLayout&&(!Base.hasLayout||(T.byteLength===Base.byteLength&&T.bitLength===Base.bitLength&&T.alignment===Base.alignment)));`)).toBe('true');
});
