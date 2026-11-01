import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, EnsureCompletion, ManagedRealm, setSurroundingAgent } from '#self';

function observe(source: string) {
  const result = observeScript(source);
  return { completion: result.completion.Type, bodyEntered: result.bodyEntered, errorClass: result.errorClass,
    diagnostic: result.diagnostic, message: (result.completion.Value as { HostDefinedMessageString?: string })?.HostDefinedMessageString,
    value: result.completion.Type === 'normal' ? (result.completion.Value as { stringValue?(): string })?.stringValue?.() : undefined };
}

test.each([
  ['direct global write', 'globalThis.f=()=>1;'],
  ['immutable global alias', 'const world=globalThis;world.f=()=>1;'],
  ['alias chain', 'const a=globalThis;const b=a;const c=b;c.f=()=>1;'],
  ['destructured global alias', 'const {globalThis:world}=globalThis;world.f=()=>1;'],
  ['destructured eval alias', 'const {eval:run}=globalThis;run("f=()=>1");'],
  ['destructured reflection', 'const {set}=Reflect;set(globalThis,"f",()=>1);'],
  ['array literal destructuring', 'const [world]=[globalThis];world.f=()=>1;'],
  ['mutable alias', 'let world;world=globalThis;world.f=()=>1;'],
  ['parenthesized alias', 'const world=(globalThis);(world).f=()=>1;'],
  ['comma result alias', 'const world=(0,globalThis);world.f=()=>1;'],
  ['conditional alias', 'const world=true?globalThis:{};world.f=()=>1;'],
  ['global this alias', 'const world=this;world.f=()=>1;'],
  ['globalThis property alias', 'const world=globalThis.globalThis;world.f=()=>1;'],
  ['constant computed key', 'const key="f";const world=globalThis;world[key]=()=>1;'],
  ['Reflect.set', 'const world=globalThis;Reflect.set(world,"f",()=>1);'],
  ['Object.defineProperty', 'const world=globalThis;Object.defineProperty(world,"f",{value:()=>1});'],
  ['Reflect.defineProperty', 'const world=globalThis;Reflect.defineProperty(world,"f",{value:()=>1});'],
  ['Object.assign', 'const world=globalThis;Object.assign(world,{f:()=>1});'],
  ['Object.defineProperties', 'const world=globalThis;Object.defineProperties(world,{f:{value:()=>1}});'],
  ['reflection object alias', 'const r=Reflect;const world=globalThis;r.set(world,"f",()=>1);'],
  ['reflection operation alias', 'const set=Reflect.set;const world=globalThis;set(world,"f",()=>1);'],
  ['reflection call', 'Reflect.set.call(null,globalThis,"f",()=>1);'],
  ['reflection apply', 'Reflect.set.apply(null,[globalThis,"f",()=>1]);'],
  ['bound reflection', 'const set=Reflect.set.bind(null,globalThis);set("f",()=>1);'],
  ['indirect eval', '(0,eval)("f=()=>1");'],
  ['eval alias', 'const run=eval;run("f=()=>1");'],
  ['global eval property', 'globalThis.eval("f=()=>1");'],
  ['optional eval', 'eval?.("f=()=>1");'],
  ['optional global eval', 'globalThis?.eval?.("f=()=>1");'],
  ['bound eval', 'const run=eval.bind(null);run("f=()=>1");'],
  ['eval call', 'eval.call(null,"f=()=>1");'],
  ['dynamic function', 'Function("f=()=>1")();'],
  ['dynamic function alias', 'const build=Function;const run=build("f=()=>1");run();'],
  ['dynamic constructor body', 'const C=Function("f=()=>1");new C();'],
  ['dynamic function call', 'Function.call(null,"f=()=>1")();'],
  ['global object passed to helper', 'function replace(world){world.f=()=>1;}replace(globalThis);'],
  ['global object passed as a later argument', 'function replace(unused,world){world.f=()=>1;}replace(0,globalThis);'],
  ['bound global receiver', 'function replace(){this.f=()=>1;}const run=replace.bind(globalThis);run();'],
  ['captured alias in called closure', 'const world=globalThis;function replace(){world.f=()=>1;}replace();'],
  ['assignment pattern target', 'const world=globalThis;[world.f]=[()=>1];'],
  ['iteration target', 'const world=globalThis;for(world.f of [()=>1]){}'],
  ['global receiver', 'function replace(){this.f=()=>1;}globalThis.replace();'],
  ['global receiver via call', 'function replace(){this.f=()=>1;}replace.call(globalThis);'],
  ['global receiver via apply', 'function replace(){this.f=()=>1;}replace.apply(globalThis,[]);'],
])('%s withdraws the replaced declaration result', (_name, mutation) => {
  expect(observe(`function f():string{return "old";}${mutation}const x:number=f();String(x);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1', errorClass: undefined });
});

test.each(['const saved=f;', 'const a=f;const saved=a;', 'const saved=(0,f);'])('a copy made after replacement does not regain the old result: %s', (copy) => {
  expect(observe(`function f():string{return "old";}const world=globalThis;world.f=()=>1;${copy}const x:number=saved();String(x);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an immutable copy captured before replacement retains its implementation result', () => {
  expect(observe('function f():string{return "old";}const saved=f;const world=globalThis;world.f=()=>1;const x:number=saved();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a later alias write does not erase an earlier call result', () => {
  expect(observe('function f():string{return "old";}const x:number=f();const world=globalThis;world.f=()=>1;'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an argument-side write does not replace the captured callee', () => {
  expect(observe('function f(x:any):string{return "old";}const world=globalThis;const x:number=f(world.f=()=>1);'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a write of another known property preserves unrelated result inference', () => {
  expect(observe('function f():string{return "old";}const world=globalThis;Object.assign(world,{unrelated:1});const x:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('the global property and an isolated local namesake have different bindings', () => {
  expect(observe('function outer(){function f():string{return "local";}const world=globalThis;world.f=()=>1;const x:number=f();}outer();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a local globalThis spelling is not the realm global object', () => {
  expect(observe('function f():string{return "old";}function mutate(){const globalThis={};const world=globalThis;world.f=()=>1;}mutate();const x:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a module function is not a global-object property', async () => {
  expect(await observeModuleGraph({ main: 'function f():string{return "local";}const world=globalThis;world.f=()=>1;const x:number=f();' }))
    .toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError' });
});

test('an unavailable result still crosses an explicit receiving boundary', () => {
  expect(observe('function f():number{return 1;}const world=globalThis;world.f=()=>"bad";const x:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('a deferred caller does not keep a result assumption lost before invocation', () => {
  expect(observe('function f():string{return "old";}function later():number{return f();}const world=globalThis;world.f=()=>1;String(later());'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a loop read cannot assume that a write on the previous iteration has not happened', () => {
  expect(observe('function f():string{return "old";}const world=globalThis;let n=0;for(let i=0;i<2;i++){if(i){const x:number=f();n=x;}world.f=()=>1;}String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('later source reads use the actual global replacement', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('function f():string{return "old";}')).Type).toBe('normal');
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('const world=globalThis;world.f=()=>1;const n:number=f();String(n);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue?(): string }).stringValue?.()).toBe('1');
});

test.each(['const world=globalThis;', 'var world=globalThis;', 'let world={};'])('a live external global alias is recognized: %s', (declaration) => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger(`function f():string{return "old";}${declaration}`)).Type).toBe('normal');
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(`${declaration.startsWith('let') ? 'world=globalThis;' : ''}world.f=()=>1;const n:number=f();String(n);`));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue?(): string }).stringValue?.()).toBe('1');
});

test.each(['"f"', 'String("f")'])('global property writes do not replace a same-named lexical binding: %s', (key) => {
  expect(observe(`let f:()=>string=():string=>"old";const world=globalThis;world[${key}]=()=>1;const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a prior source lexical binding is not its namesake global property', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('const f=():string=>"old";const world=globalThis;')).Type).toBe('normal');
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('world.f=()=>1;const n:number=f();'));
  expect(result.Type).toBe('throw');
  expect((result.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString).toContain('StaticTypeError: "string" is not assignable to "number"');
});

test('indirect dynamic code can replace a mutable global lexical binding', () => {
  expect(observe('let f:()=>string=():string=>"old";(0,eval)("f=()=>1");const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('constructing dynamic source does not execute its body', () => {
  expect(observe('function f():string{return "old";}const run=Function("f=()=>1");const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('binding reflection arguments does not perform the write', () => {
  expect(observe('function f():string{return "old";}const set=Reflect.set.bind(null,globalThis,"f",()=>1);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an imported global alias does not replace a module-local function', async () => {
  expect(await observeModuleGraph({ producer: 'export const world=globalThis;', main: 'import {world} from "producer";function f():string{return "local";}world.f=()=>1;const n:number=f();' }))
    .toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError' });
});
