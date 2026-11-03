import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ProduceArtifact, FinishLoadingImportedModule, Value, Descriptor } from '#self';

const declaration = `const p=x=>x>0; const T=Reflect.makeType({kind:'parameterized',base:number,metadata:{where:p}});`;

test.each([
  ['binding','let value:T=input;'], ['parameter','function f(value:T){} f(input);'],
  ['return','function f():T{return input;}f();'], ['property','const value:{x:T}={x:input};'],
  ['array','const value:[].<T>=[input];'], ['tuple','const value:[T]=[input];'],
  ['assignment','let value:T=1;value=input;'],
])('enforces the %s boundary', (_name, body) => {
  expect(evaluated(`${declaration}const input:any=1;${body}'ok';`)).toBe('ok');
  expectThrownKind(`${declaration}const input:any=-1;${body}`, 'TypeError');
});

test('a mutable typed property rechecks the predicate on writes', () => {
  expectThrownKind(`${declaration}const value:{x:T}={x:1};const input:any=-1;value.x=input;`, 'TypeError');
});

test('a mutable typed array rechecks the predicate on stores', () => {
  expectThrownKind(`${declaration}const value:[].<T>=[1];const input:any=-1;value[0]=input;`, 'TypeError');
});

test('predicate throw does not corrupt later evaluation state', () => {
  expect(evaluated(`const Bad=Reflect.makeType({kind:'parameterized',base:number,metadata:{where:x=>{throw 'bad';}}});try{1 is Bad;}catch{} ${declaration}String(1 is T)+','+String(Math.random()>=0);`)).toBe('true,true');
});

test('an infinite predicate is charged to the semantic type budget', () => {
  setSurroundingAgent(new Agent({features:['runtime-types']}));
  const realm=new ManagedRealm({typeEvaluationBudget:{steps:2000,records:2000,depth:50}} as never);
  const c=EnsureCompletion(realm.evaluateScriptSkipDebugger(`const T=Reflect.makeType({kind:'parameterized',base:number,metadata:{where:x=>{while(true){}}}});1 is T;`));
  expect(c.Type).toBe('throw');
  expect((c.Value as {HostDefinedMessageString?:string}).HostDefinedMessageString).toContain('budget');
});

async function artifact(source: string) {
  setSurroundingAgent(new Agent({features:['runtime-types']}));
  const realm=new ManagedRealm();
  const compiled=EnsureCompletion(realm.compileModule(source,{specifier:'where.mts'} as never));
  expect(compiled.Type).toBe('normal');
  const completion=await new Promise<unknown>((resolve)=>realm.evaluateModule(compiled.Value as never,undefined,resolve));
  expect(completion).toMatchObject({PromiseState:'fulfilled'});
  return ProduceArtifact(compiled.Value);
}

test.each([
  'type A=number where this>0;export {A};',
  'type P=number where this>0;type A={p:P};export {A};',
  'type P=number where this>0;type A=[P];export {A};',
])('records an explicit artifact omission for %s', async (source) => {
  const result=await artifact(source);
  expect(result).toBeDefined();
  expect(result!.table.exports).toEqual({});
  expect(result!.skipped.A).toContain('where predicate');
});

test('keeps encodable exports beside an omitted predicate-bearing export', async () => {
  const result=await artifact('type A=number where this>0;type B={x:number};export {A,B};');
  expect(Object.keys(result!.table.exports)).toEqual(['B']);
  expect(Object.keys(result!.skipped)).toEqual(['A']);
});

test('a reference write still enforces the refined storage type', () => {
  expectThrownKind(`${declaration}let v:T=1;let ref r=v;const input:any=-1;r=input;`, 'TypeError');
});

test('a removed refined array element still invalidates its reference', () => {
  expectThrownKind(`${declaration}let a:[].<T>=[1];let ref r=a[0];a.pop();String(r);`, 'TypeError');
});

test('source refinement preserves its declaring private environment', () => {
  expect(evaluated(`class C { #n=1; static refined(){type T=C where this.#n>0;return T;} } const T=C.refined();String(new C() is T);`)).toBe('true');
});

test('public predicates preserve their declaring private environment', () => {
  expect(evaluated(`class C { #n=1; static refined(){return Reflect.makeType({kind:'parameterized',base:C,metadata:{where:x=>x.#n>0}});} } const T=C.refined();String(new C() is T);`)).toBe('true');
});

test('catching a predicate exception cannot clear sticky budget exhaustion', () => {
  setSurroundingAgent(new Agent({features:['runtime-types']}));
  const realm=new ManagedRealm({typeEvaluationBudget:{steps:2000,records:2000,depth:50}} as never);
  const c=EnsureCompletion(realm.evaluateScriptSkipDebugger(`const T=Reflect.makeType({kind:'parameterized',base:number,metadata:{where:x=>{try{while(true){}}catch{}return true;}}});1 is T;`));
  expect(c.Type).toBe('throw');
  expect((c.Value as {HostDefinedMessageString?:string}).HostDefinedMessageString).toContain('budget');
});

async function importedResult(dependency: string, entry: string, expected: string) {
  setSurroundingAgent(new Agent({features:['runtime-types'],hostHooks:{
    HostLoadImportedModule(referrer, request, _hostDefined, payload) {
      const compiled=realm.compileModule(dependency,{specifier:request.Specifier} as never);
      FinishLoadingImportedModule(referrer,request,payload,compiled);
    },
  }}));
  const realm=new ManagedRealm();
  const compiled=EnsureCompletion(realm.compileModule(entry,{specifier:'entry.mts'} as never));
  expect(compiled.Type).toBe('normal');
  const completion=await new Promise<unknown>((resolve)=>realm.evaluateModule(compiled.Value as never,undefined,resolve));
  expect(completion).toMatchObject({PromiseState:'fulfilled'});
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('globalThis.out')).Value).toEqual(Value(expected));
}

test('a predicate captures an initialized imported constant', async () => {
  await importedResult('export const limit=2;',
    `import {limit} from './dep.mts';const T=Reflect.makeType({kind:'parameterized',base:number,metadata:{where:x=>x>limit}});globalThis.out=String(3 is T)+','+String(1 is T);`, 'true,false');
});

test('an imported helper retains its defining module environment', async () => {
  await importedResult('const limit=2;export function p(x){return x>limit;}',
    `import {p} from './dep.mts';const limit=100;const T=Reflect.makeType({kind:'parameterized',base:number,metadata:{where:p}});globalThis.out=String(3 is T);`, 'true');
});

test('an imported source refinement retains its defining module environment', async () => {
  await importedResult('const limit=2;export type T=number where this>limit;',
    `import {T} from './dep.mts';const limit=100;globalThis.out=String(3 is T);`, 'true');
});

test('import immutability does not hide a mutable exporting capture', async () => {
  await importedResult('export let limit=2;',
    `import {limit} from './dep.mts';try{Reflect.makeType({kind:'parameterized',base:number,metadata:{where:x=>x>limit}});globalThis.out='accepted';}catch(e){globalThis.out=String(e instanceof TypeError);}`, 'true');
});

test('nominal artifact traversal does not serialize private refinement-bearing structure', async () => {
  const result=await artifact('type P=number where this>0;class A{p:P=1;}export {A};');
  expect(Object.keys(result!.table.exports)).toEqual(['A']);
  expect(result!.skipped).toEqual({});
});

test('a refinement in a nominal argument requires artifact omission', async () => {
  const result=await artifact('type P=number where this>0;class Box<T:type>{v:T;}type A=Box.<P>;export {A};');
  expect(result!.table.exports).toEqual({});
  expect(result!.skipped.A).toContain('where predicate');
});


test('a foreign predicate retains its own realm intrinsic identities', () => {
  setSurroundingAgent(new Agent({features:['runtime-types']}));
  const foreign=new ManagedRealm();
  const predicate=EnsureCompletion(foreign.evaluateScriptSkipDebugger('const limit=1;const p=x=>Math.abs(x)>limit;p;'));
  expect(predicate.Type).toBe('normal');
  const realm=new ManagedRealm();
  realm.GlobalObject.properties.set(Value('foreignPredicate'),Descriptor({Value:predicate.Value as never,Writable:Value.false,Configurable:Value.false}));
  const result=EnsureCompletion(realm.evaluateScriptSkipDebugger(`const T=Reflect.makeType({kind:'parameterized',base:number,metadata:{where:foreignPredicate}});Math.abs=x=>0;String(-2 is T);`));
  expect(result.Type).toBe('normal');
  expect(result.Value).toEqual(Value('true'));
});

test('cached admission still charges its logical inspection work', () => {
  setSurroundingAgent(new Agent({features:['runtime-types']}));
  const limits={steps:10000,records:10000,depth:50};
  const realm=new ManagedRealm({typeEvaluationBudget:limits} as never);
  const setup=EnsureCompletion(realm.evaluateScriptSkipDebugger(`const p=x=>{${';'.repeat(500)}return true;};const T=Reflect.makeType({kind:'parameterized',base:number,metadata:{where:p}});`));
  expect(setup.Type).toBe('normal');
  limits.steps=300;
  const cached=EnsureCompletion(realm.evaluateScriptSkipDebugger(`Reflect.makeType({kind:'parameterized',base:number,metadata:{where:p}});`));
  expect(cached.Type).toBe('throw');
  expect((cached.Value as {HostDefinedMessageString?:string}).HostDefinedMessageString).toContain('budget');
});
