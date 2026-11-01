import { expect, test } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, EnsureCompletion, ManagedRealm, ObjectValue, setSurroundingAgent } from '#self';

/** Observe only the consuming Script; do not prepend code or invoke a probe getter. */
function observe(setup: string, source: string) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const initial = EnsureCompletion(realm.evaluateScriptSkipDebugger(setup));
  expect(initial.Type, (initial.Value as { HostDefinedMessageString?: string })?.HostDefinedMessageString).toBe('normal');
  let bodyEntered = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyEntered = true;
  };
  try {
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    const errorClass = result.Type === 'throw' && result.Value instanceof ObjectValue && 'Prototype' in result.Value
      ? (['StaticTypeError', 'TypeError', 'Error', 'ReferenceError'] as const).find((name) =>
        (result.Value as ObjectValue & { Prototype: unknown }).Prototype === realm.Intrinsics[`%${name}.prototype%`]) : undefined;
    return { completion: result.Type, bodyEntered, errorClass,
      value: result.Type === 'normal' ? (result.Value as { stringValue?(): string }).stringValue?.() : undefined,
      message: (result.Value as { HostDefinedMessageString?: string })?.HostDefinedMessageString };
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
}

const routes = [
  ['earlier accessor', 'const box={get world(){return globalThis;}};', 'box.world.f=()=>1;'],
  ['earlier inherited accessor', 'const box=Object.create({get world(){return globalThis;}});', 'box.world.f=()=>1;'],
  ['earlier inherited data', 'const box=Object.create({world:globalThis});', 'box.world.f=()=>1;'],
  ['earlier Map storage', 'const box=new Map([["world",globalThis]]);', 'box.get("world").f=()=>1;'],
  ['earlier native callable alias', 'const get=Map.prototype.get;const box=new Map([["world",globalThis]]);', 'get.call(box,"world").f=()=>1;'],
  ['earlier WeakMap storage', 'const key={};const box=new WeakMap([[key,globalThis]]);', 'box.get(key).f=()=>1;'],
  ['earlier Set iterator', 'const box=new Set([globalThis]);', 'box.values().next().value.f=()=>1;'],
  ['earlier generated callable', 'const get=Function("return globalThis");', 'get().f=()=>1;'],
  ['earlier generated constructor', 'const Get=Function("return globalThis");', '(new Get()).f=()=>1;'],
  ['earlier bound generated callable', 'const get=Function("return globalThis").bind(null);', 'get().f=()=>1;'],
  ['earlier source callable', 'const get=()=>globalThis;', 'get().f=()=>1;'],
  ['earlier stored source callable', 'const box={get:()=>globalThis};', 'box.get().f=()=>1;'],
  ['earlier ordinary method', 'const box={get(){return globalThis;}};', 'box.get().f=()=>1;'],
  ['earlier closure', 'const get=(()=>{const world=globalThis;return ()=>world;})();', 'get().f=()=>1;'],
  ['earlier proxy object', 'const box=new Proxy({},{get(){return globalThis;}});', 'box.world.f=()=>1;'],
  ['earlier proxy callable', 'const get=new Proxy(()=>globalThis,{});', 'get().f=()=>1;'],
  ['call of earlier callable', 'const get=()=>globalThis;', 'get.call(null).f=()=>1;'],
  ['apply of earlier callable', 'const get=()=>globalThis;', 'get.apply(null,[]).f=()=>1;'],
  ['bind of earlier callable then invocation', 'const get=()=>globalThis;', 'const run=get.bind(null);run().f=()=>1;'],
  ['optional earlier callable', 'const get=()=>globalThis;', 'const world=get?.();world.f=()=>1;'],
  ['optional earlier accessor', 'const box={get world(){return globalThis;}};', 'const world=box?.world;world.f=()=>1;'],
  ['destructured earlier accessor', 'const box={get world(){return globalThis;}};', 'const {world}=box;world.f=()=>1;'],
  ['nested earlier accessor', 'const box={nested:{get world(){return globalThis;}}};', 'box.nested.world.f=()=>1;'],
  ['earlier mutating callback', 'const mutate=()=>{globalThis.f=()=>1;};', 'mutate();'],
  ['earlier mutating getter', 'const box={get run(){globalThis.f=()=>1;return 0;}};', 'box.run;'],
  ['earlier mutating inherited setter', 'const box=Object.create({set run(value){globalThis.f=()=>1;}});', 'box.run=0;'],
  ['implicit destructuring getter', 'const box={get run(){globalThis.f=()=>1;return 0;}};', 'const {run}=box;'],
  ['implicit assignment-pattern getter', 'const box={get run(){globalThis.f=()=>1;return 0;}};', 'let run;({run}=box);'],
  ['implicit spread getter', 'const box={get run(){globalThis.f=()=>1;return 0;}};', 'const copy={...box};'],
  ['implicit assign getter', 'const box={get run(){globalThis.f=()=>1;return 0;}};', 'Object.assign({},box);'],
  ['implicit descriptor getter', 'const descriptor={get value(){globalThis.f=()=>1;return 0;}};', 'Object.defineProperty({},"x",descriptor);'],
  ['apply argument getter', 'const args={length:1,get 0(){globalThis.f=()=>1;return 0;}};', 'function ignore(x){}ignore.apply(null,args);'],
] as const;

test.each(routes)('%s withdraws the stale result at the later read', (_name, setup, mutation) => {
  expect(observe(setup, `function f():string{return "old";}${mutation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(routes.slice(0, 10))('%s cannot bypass an explicit receiving boundary', (_name, setup, mutation) => {
  expect(observe(setup, `function f():number{return 1;}${mutation.replace('()=>1', '()=>"bad"')}const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('an earlier getter runs once at runtime, with no checking-time read', () => {
  expect(observe('let reads=0;const box={get world(){reads++;return globalThis;}};',
    'function f():string{return "old";}box.world.f=()=>1;const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('an abrupt earlier getter is neither executed early nor retried', () => {
  expect(observe('let reads=0;const box={get world(){reads++;throw new Error("stop");}};',
    'function f():string{return "old";}try{box.world.f=()=>1;}catch(e){}let rejected=false;try{const n:number=f();}catch(e){rejected=e instanceof TypeError;}String(reads)+":"+String(rejected);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:true' });
});

test('an earlier proxy trap runs once in the actual lookup', () => {
  expect(observe('let reads=0;const box=new Proxy({},{get(){reads++;return globalThis;}});',
    'function f():string{return "old";}box.world.f=()=>1;const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a callee copied before an opaque effect preserves the captured implementation', () => {
  expect(observe('const box={get world(){return globalThis;}};',
    'function f():string{return "old";}const before=f;box.world.f=()=>1;const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a callee copied after an opaque effect does not recover the previous result', () => {
  expect(observe('const box={get world(){return globalThis;}};',
    'function f():string{return "old";}box.world.f=()=>1;const after=f;const n:number=after();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('argument-side opaque access does not change the callee already captured', () => {
  expect(observe('const box={get world(){globalThis.f=()=>1;return 0;}};',
    'function f(x:any):string{return "old";}const n:number=f(box.world);'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a later opaque effect does not erase an earlier read', () => {
  expect(observe('const mutate=()=>{globalThis.f=()=>1;};',
    'function f():string{return "old";}const n:number=f();mutate();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a known ordinary own-data store does not invoke a foreign accessor', () => {
  expect(observe('const box={field:0};', 'function f():string{return "old";}box.field=1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a known ordinary own-data property read preserves unrelated global evidence', () => {
  expect(observe('const box={field:1};', 'function f():string{return "old";}box.field;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a data descriptor holding undefined is distinct from an accessor or missing property', () => {
  expect(observe('const box={field:undefined};', 'function f():string{return "old";}box.field;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an opaque operation cannot replace a same-named isolated local binding', () => {
  expect(observe('const box={get world(){return globalThis;}};',
    'function outer(){function f():string{return "old";}box.world.f=()=>1;const n:number=f();}outer();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('ambient effects can reach mutable global lexicals', () => {
  expect(observe('const mutate=()=>{(0,eval)("f=()=>1");};',
    'let f:()=>string=():string=>"old";mutate();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('opaque effects do not erase an immutable lexical callable contract', () => {
  expect(observe('const mutate=()=>{globalThis.f=()=>1;};',
    'const f=():string=>"old";mutate();const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an earlier declared callable result is not erased by its possible effects', () => {
  expect(observe('const get=():string=>"old";', 'const n:number=get();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a module local remains distinct from an imported opaque operation', async () => {
  expect(await observeModuleGraph({ producer: 'export const mutate=()=>{globalThis.f=()=>1;};',
    main: 'import {mutate} from "producer";function f():string{return "old";}mutate();const n:number=f();' }))
    .toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError' });
});

test('destructuring getters precede reads in pattern defaults', () => {
  expect(observe('const box={get field(){globalThis.f=()=>1;return undefined;}};',
    'function f():string{return "old";}const {field:n:number=f()}=box;String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('destructuring does not precede the right-hand initializer call', () => {
  expect(observe('const box={get field(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}function take(n:number){return box;}const {field}=take(f());'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('apply reads its argument-container length even for a zero-parameter target', () => {
  expect(observe('const args={get length(){(0,eval)("f=()=>1");return 0;}};',
    'let f:()=>string=():string=>"old";function ignore(){}ignore.apply(null,args);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('merely reading an earlier callable does not execute its body', () => {
  expect(observe('const box={mutate:()=>{globalThis.f=()=>1;}};',
    'function f():string{return "old";}const saved=box.mutate;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('String primitive conversion preserves an unrelated mutable lexical result', () => {
  expect(observe('const stringify=String;',
    'let f:()=>string=():string=>"old";stringify("f");const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('String object conversion can call earlier user code', () => {
  expect(observe('const stringify=String;const box={toString(){(0,eval)("f=()=>1");return "f";}};',
    'let f:()=>string=():string=>"old";stringify(box);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a bound coercible argument is not hidden by a primitive call argument', () => {
  expect(observe('const stringify=String;const box={toString(){(0,eval)("f=()=>1");return "f";}};',
    'let f:()=>string=():string=>"old";const bound=stringify.bind(null,box);bound("f");const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('Symbol object conversion retains a possible user coercion effect', () => {
  expect(observe('const symbol=Symbol;const box={toString(){(0,eval)("f=()=>1");return "key";}};',
    'let f:()=>string=():string=>"old";symbol(box);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a replaced global String property is not the intrinsic by spelling', () => {
  expect(observe('globalThis.String=()=>{globalThis.f=()=>1;return "";};',
    'function f():string{return "old";}globalThis.String("literal");const n:number=f();""+n;'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a String static method does not inherit the literal-call summary', () => {
  expect(observe('const box={valueOf(){(0,eval)("f=()=>1");return 65;}};',
    'let f:()=>string=():string=>"old";String.fromCharCode(box);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});
