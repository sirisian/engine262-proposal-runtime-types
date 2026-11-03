import { expect, test } from 'vitest';
import { evaluated, expectThrownKind, observeScript } from '../harness.mts';

const make = (predicate: string, base = 'number') => `Reflect.makeType({kind:'parameterized',base:(${base==='void'?'type void':base}),metadata:{where:${predicate}}})`;

test.each(['x => x > 0', 'function(x) { return x > 0; }', '(x = 0) => x > 0', '({x}) => x > 0'])('admits a unary synchronous callback: %s', (predicate) => {
  expect(evaluated(`const p = ${predicate}; const T = ${make('p')}; String(Reflect.getReflection(T).metadata.where === p);`)).toBe('true');
});

test.each(['undefined', 'null', 'true', '0', '"x"', '{}', '[]', '()=>true', '(x,y)=>true', '(...x)=>true',
  'async x=>true', 'function*(x){yield true;}', '(x=>true).bind(null)', 'new Proxy(x=>true,{})', 'Math.abs', 'class { constructor(x) {} }'])('rejects inadmissible where: %s', (predicate) => {
  expectThrownKind(`${make(predicate)};`, 'TypeError');
});

test.each(['void', 'never', 'number'])('validates the predicate even for base %s', (base) => {
  expectThrownKind(`${make('undefined', base)};`, 'TypeError');
  expect(evaluated(`const T = ${make('x=>false', base)}; String(Reflect.getReflection(T).kind);`)).toBe('parameterized');
});

test('does not call a predicate while constructing, reflecting, or comparing types', () => {
  expect(evaluated(`const p = x => { throw 'ran'; }; const T = ${make('p')}; const U = ${make('p')}; String(T === U && Reflect.makeType(Reflect.getReflection(T)) === T);`)).toBe('true');
});

test('does not read a callable length property to establish arity', () => {
  expect(evaluated(`const p=x=>true; Object.defineProperty(p,'length',{get(){throw 'length';}}); const T=${make('p')}; String(1 is T);`)).toBe('true');
});

test('snapshots metadata in own key order and reads each getter once', () => {
  expect(evaluated(`let log=''; const p=x=>true; type Extra={extra:string}; meta Extra {default={extra:''};subtype(a,b){return true;}} const T=Reflect.makeType({kind:'parameterized',base:number,metadata:{get extra(){log+='e';return 'x';},get where(){log+='w';return p;}}}); log;`)).toBe('ew');
});

test('invalid where stops traversal before a later getter', () => {
  expect(evaluated(`let log=''; try {Reflect.makeType({kind:'parameterized',base:number,metadata:{get where(){log+='w';return undefined;},get later(){log+='l';return 1;}}});}catch{} log;`)).toBe('w');
});

test('an earlier getter exception precedes predicate admission', () => {
  expect(evaluated(`let log=''; try {Reflect.makeType({kind:'parameterized',base:number,metadata:{get earlier(){throw 'first';},get where(){log+='w';return undefined;}}});}catch(e){log+=e;} log;`)).toBe('first');
});

test.each(['{nested:{where:p}}', '{nested:[p]}', '{[Symbol("where")]:p}'])('does not extend the nested metadata value language: %s', (metadata) => {
  expectThrownKind(`const p=x=>true; Reflect.makeType({kind:'parameterized',base:number,metadata:${metadata}});`, 'TypeError');
});

test('ignores inherited and non-enumerable where fields', () => {
  expect(evaluated(`const metadata=Object.create({where:undefined}); Object.defineProperty(metadata,'where',{value:undefined,enumerable:false}); const T=Reflect.makeType({kind:'parameterized',base:number,metadata}); String(1 is T);`)).toBe('true');
});

test('retains the original function without freezing or cloning it', () => {
  expect(evaluated(`const p=x=>true; const T=${make('p')}; p.extra=7; String(Reflect.getReflection(T).metadata.where===p)+','+p.extra+','+Object.isFrozen(p);`)).toBe('true,7,false');
});

test('the built-in owner reserves the string where key', () => {
  expect(observeScript('type UserWhere={where:any};meta UserWhere {default={where:null};subtype(a,b){return true;}}').completion.Type).toBe('throw');
});

test('source metadata parameterization admits the same top-level callback', () => {
  expect(evaluated(`const p=x=>x>0;function metadata(){return {where:p};}type T=number.<metadata()>;const U=${make('p')};String(T===U)+','+String(1 is T)+','+String(-1 is T);`)).toBe('true,true,false');
});

test('source metadata parameterization still rejects a nested callback', () => {
  expectThrownKind('const p=x=>true;function metadata(){return {extra:{where:p}};}type T=number.<metadata()>;', 'TypeError');
});
