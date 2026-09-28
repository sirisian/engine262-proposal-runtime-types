import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  'const M=Map;new M.<uint8,string,boolean>();',
  'function unused(x:Map.<>){ }',
  'function unused(x:Generator.<R:string>){ }',
  "function unused(x:Map.<uint8,string,boolean>){}",
  "new Map.<uint8,string,boolean>();",
  "function unused(x:Promise.<uint8,string,boolean>){}",
  "new FinalizationRegistry.<string,uint8>((x:string):void=>{});",
  "new FinalizationRegistry.<wrong:string>((x:string):void=>{});",
  "function unused(x:Map.<uint8>){}",
  "function unused(x:Set.<any,any,any,any>){}",
  "function unused(x:WeakSet.<any,any,any,any>){}",
  "function unused(x:WeakMap.<any,any,any,any>){}",
  "function unused(x:WeakRef.<any,any,any,any>){}",
  "function unused(x:FinalizationRegistry.<any,any,any,any>){}",
  "function unused(x:Proxy.<any,any,any,any>){}",
  "function unused(x:Generator.<any,any,any,any>){}",
  "function unused(x:AsyncGenerator.<any,any,any,any>){}",
  "function unused(x:Map.<missing:uint8,V:string>){}",
  "new Map.<...[uint8,string,boolean]>();"
])('rejects an invalid established contract: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "function unused(x:Map.<uint8,string>){}new Map.<uint8,string>();",
  "new FinalizationRegistry.<string>((x:string):void=>{});",
  "new Map();new FinalizationRegistry((x:string):void=>{});",
  "function unused(x:Promise.<uint8>){}",
  "class Map<A:type,B:type,C:type>{}function unused(x:Map.<uint8,string,boolean>){}",
  "function unused(x:Map.<V:string,K:uint8>){}new Map.<V:string,K:uint8>();",
  "let m:Map.<uint8,string>=new Map.<V:string,K:uint8>();",
  "new Promise.<E:string,R:uint8>((resolve,reject)=>{resolve(1);});",
  "function unused(x:Promise.<E:string>){}",
  "function unused(x:Generator.<uint8>){}function another(x:AsyncGenerator.<Y:uint8>){}",
  "function unused(x:Map.<...[uint8,string]>){}new Map.<...[uint8,string]>();",
  "class Promise<A:type,B:type,C:type>{}function unused(x:Promise.<uint8,string,boolean>){}",
  "class Map<A:type,B:type,C:type>{}new Map.<uint8,string,boolean>();",
  'function unused(x:Promise.<>){ }new Promise.<>((resolve,reject)=>{});',
  'Map=class<A:type,B:type,C:type>{};new Map.<uint8,string,boolean>();',
  'function unused(){new Map.<uint8,string,boolean>();}',
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test('duplicate labels remain a syntax error', () => {
  expectEarlyError('function unused(x:Map.<K:uint8,K:string>){}', 'SyntaxError');
});

test.each([
  'new C.<uint8,string,boolean>()',
  'C.<...[uint8,string,boolean]>',
  'new C.<missing:uint8,V:string>()',
])('an unresolved constructor retains runtime argument binding: %s', (expression) => {
  expect(evaluated(`const C:any=Map;let caught=false;try { ${expression}; } catch (e) { caught=true; } String(caught);`)).toBe('true');
});
