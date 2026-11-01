import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { Agent, EnsureCompletion, ManagedRealm, setSurroundingAgent } from '#self';

function observe(source: string) {
  const result = observeScript(source);
  return { completion: result.completion.Type, bodyEntered: result.bodyEntered, errorClass: result.errorClass,
    message: (result.completion.Value as { HostDefinedMessageString?: string })?.HostDefinedMessageString,
    value: result.completion.Type === 'normal' ? (result.completion.Value as { stringValue?(): string })?.stringValue?.() : undefined };
}

test.each([
  ['object storage', 'const box={world:globalThis};box.world.f=()=>1;'],
  ['nested object storage', 'const box={inner:{world:globalThis}};box.inner.world.f=()=>1;'],
  ['array storage', 'const box=[globalThis];box[0].f=()=>1;'],
  ['mixed storage', 'const box={items:[{world:globalThis}]};box.items[0].world.f=()=>1;'],
  ['shorthand property', 'const world=globalThis;const box={world};box.world.f=()=>1;'],
  ['computed property', 'const key="world";const box={[key]:globalThis};box[key].f=()=>1;'],
  ['mutable container alias', 'let box;box={world:globalThis};box.world.f=()=>1;'],
  ['stored value loaded into alias', 'const box={world:globalThis};const world=box.world;world.f=()=>1;'],
  ['store after allocation', 'const box={};box.world=globalThis;box.world.f=()=>1;'],
  ['store through another alias', 'const box={};const alias=box;alias.world=globalThis;box.world.f=()=>1;'],
  ['reflective store', 'const box={};Reflect.set(box,"world",globalThis);box.world.f=()=>1;'],
  ['descriptor store', 'const box={};Object.defineProperty(box,"world",{value:globalThis});box.world.f=()=>1;'],
  ['descriptor map store', 'const box={};Object.defineProperties(box,{world:{value:globalThis}});box.world.f=()=>1;'],
  ['assign store', 'const box={};Object.assign(box,{world:globalThis});box.world.f=()=>1;'],
  ['assign result', 'const box=Object.assign({},{world:globalThis});box.world.f=()=>1;'],
  ['global heap property', 'globalThis.box={world:globalThis};globalThis.box.world.f=()=>1;'],
  ['global object binding read', 'globalThis.box={world:globalThis};box.world.f=()=>1;'],
  ['unknown store key', 'const box={};box[String("world")]=globalThis;box.world.f=()=>1;'],
  ['cyclic storage', 'const box={world:globalThis};box.self=box;box.self.self.world.f=()=>1;'],
  ['object spread', 'const box={world:globalThis};const copy={...box};copy.world.f=()=>1;'],
  ['array spread', 'const box=[globalThis];const copy=[...box];copy[0].f=()=>1;'],
  ['destructured stored value', 'const box={world:globalThis};const {world}=box;world.f=()=>1;'],
  ['destructuring assignment', 'const box={world:globalThis};let world;({world}=box);world.f=()=>1;'],
  ['array assignment pattern', 'const box=[globalThis];let world;[world]=box;world.f=()=>1;'],
  ['returned direct alias', 'function world(){return globalThis;}world().f=()=>1;'],
  ['returned container', 'function box(){return {world:globalThis};}box().world.f=()=>1;'],
  ['returned argument', 'function id(x){return x;}id(globalThis).f=()=>1;'],
  ['returned nested argument', 'function get(box){return box.world;}get({world:globalThis}).f=()=>1;'],
  ['arrow result', 'const get=()=>globalThis;get().f=()=>1;'],
  ['callback result', 'function get(callback){return callback();}get(()=>globalThis).f=()=>1;'],
  ['method result', 'const box={world(){return globalThis;}};box.world().f=()=>1;'],
  ['getter result', 'const box={get world(){return globalThis;}};box.world.f=()=>1;'],
  ['returned receiver', 'const box={world:globalThis,get(){return this.world;}};box.get().f=()=>1;'],
  ['parameter write', 'function replace(box){box.world.f=()=>1;}replace({world:globalThis});'],
  ['stored eval', 'const box={run:eval};box.run("f=()=>1");'],
  ['stored dynamic builder', 'const box={build:Function};box.build("f=()=>1")();'],
  ['stored generated function', 'const box={run:Function("f=()=>1")};box.run();'],
  ['stored reflection', 'const box={set:Reflect.set};box.set(globalThis,"f",()=>1);'],
  ['nonliteral apply container', 'const args=[globalThis,"f",()=>1];Reflect.set.apply(null,args);'],
  ['returned apply argument', 'function id(x){return x;}const args=[globalThis];id.apply(null,args).f=()=>1;'],
  ['returned call argument', 'function id(x){return x;}id.call(null,globalThis).f=()=>1;'],
  ['bound returning function', 'function id(x){return x;}const get=id.bind(null,globalThis);get().f=()=>1;'],
  ['bound stored receiver', 'const box={world:globalThis,get(){return this.world;}};const get=box.get.bind(box);get().f=()=>1;'],
  ['optional stored alias', 'const box={world:globalThis};const world=box?.world;world.f=()=>1;'],
])('%s withdraws the stale global result', (_name, mutation) => {
  expect(observe(`function f():string{return "old";}${mutation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a container is not the global object it contains', () => {
  expect(observe('function f():string{return "old";}const box={world:globalThis};box.f=()=>1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('allocation identity distinguishes two containers with the same property name', () => {
  expect(observe('function f():string{return "old";}const a={world:globalThis};const b={world:{}};b.world.f=()=>1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('property identity distinguishes global and ordinary members of a container', () => {
  expect(observe('function f():string{return "old";}const box={world:globalThis,local:{}};box.local.f=()=>1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('array indices distinguish global and ordinary members', () => {
  expect(observe('function f():string{return "old";}const box=[globalThis,{}];box[1].f=()=>1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a named heap-mediated write preserves an unrelated global result', () => {
  expect(observe('function f():string{return "old";}const box={world:globalThis};box.world.other=()=>1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an immutable callee captured before a heap-mediated write retains its result', () => {
  expect(observe('function f():string{return "old";}const saved=f;const box={world:globalThis};box.world.f=()=>1;const n:number=saved();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a callee copied after a heap-mediated write does not regain the old result', () => {
  expect(observe('function f():string{return "old";}const box={world:globalThis};box.world.f=()=>1;const saved=f;const n:number=saved();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('heap effects do not replace an isolated same-named local binding', () => {
  expect(observe('function outer(){function f():string{return "old";}const box={world:globalThis};box.world.f=()=>1;const n:number=f();}outer();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an incompatible heap-mediated replacement retains receiving admission', () => {
  expect(observe('function f():number{return 1;}const box={world:globalThis};box.world.f=()=>"bad";const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('getters run once during execution and are not invoked by alias analysis', () => {
  expect(observe('function f():string{return "old";}let reads=0;const box={get world(){reads++;return globalThis;}};box.world.f=()=>1;const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('prior-source ordinary own data can carry a global alias', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('function f():string{return "old";}const box={world:globalThis};')).Type).toBe('normal');
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('box.world.f=()=>1;const n:number=f();String(n);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue?(): string }).stringValue?.()).toBe('1');
});

test('stored eval can reach a global lexical callable without confusing it with a property', () => {
  expect(observe('let f:()=>string=():string=>"old";const box={run:eval};box.run("f=()=>1");const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a stored property alias does not replace a same-named global lexical callable', () => {
  expect(observe('let f:()=>string=():string=>"old";const box={world:globalThis};box.world.f=()=>1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an argument-side heap write does not change the callee already captured', () => {
  expect(observe('function f(x:any):string{return "old";}const box={world:globalThis};const n:number=f(box.world.f=()=>1);'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an ordinary returned object is not classified as the global object', () => {
  expect(observe('function f():string{return "old";}function box(){return {world:{}};}box().world.f=()=>1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a nonliteral apply container carries arguments beyond a small fixed prefix', () => {
  const parameters = Array.from({ length: 20 }, (_, i) => `p${i}`).join(',');
  const args = Array.from({ length: 20 }, (_, i) => i === 19 ? 'globalThis' : '0').join(',');
  expect(observe(`function f():string{return "old";}function get(${parameters}){return p19;}const args=[${args}];get.apply(null,args).f=()=>1;const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a nested heap path preserves its possible global origin', () => {
  const declarations = Array.from({ length: 16 }, (_, i) => `const box${i}={next:${i ? `box${i - 1}` : 'globalThis'}};`).join('');
  const path = `box15${'.next'.repeat(16)}`;
  expect(observe(`function f():string{return "old";}${declarations}${path}.f=()=>1;const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});
