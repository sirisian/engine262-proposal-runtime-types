import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

function observe(source: string) {
  const result = observeScript(source);
  return { bodyEntered: result.bodyEntered, errorClass: result.errorClass, diagnostic: result.diagnostic,
    completion: result.completion.Type, message: (result.completion.Value as { HostDefinedMessageString?: string })?.HostDefinedMessageString,
    value: result.completion.Type === 'normal' ? (result.completion.Value as { stringValue?(): string })?.stringValue?.() : undefined };
}

test.each([
  ['direct global property', 'globalThis.f=()=>"bad";'],
  ['global object alias', 'const world=globalThis;world.f=()=>"bad";'],
  ['computed global property', 'const key="f";globalThis[key]=()=>"bad";'],
  ['Reflect.set', 'Reflect.set(globalThis,"f",()=>"bad");'],
  ['defineProperty', 'Object.defineProperty(globalThis,"f",{value:()=>"bad"});'],
  ['indirect eval', '(0,eval)("f=()=>\\"bad\\"");'],
  ['aliased eval', 'const run=eval;run("f=()=>\\"bad\\"");'],
  ['dynamic function', 'Function("f=()=>\\"bad\\"")();'],
])('%s cannot bypass a declared return', (_name, mutation) => {
  const result = observe(`function f():uint8{return 1;}function g():uint8{return f();}${mutation}g();`);
  expect(result).toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
  expect(result.message).toContain('uint.<8>');
});

test.each([
  ['plain const storage', 'function bad(){return "bad";}const f:()=>uint8=bad;'],
  ['callable parameter', 'function bad(){return "bad";}const f:()=>uint8=bad;'],
  ['readonly property', 'const box:{readonly f:()=>uint8}={f:()=>1};const erased:any=box;erased.f=()=>"bad";const f=()=>box.f();'],
])('%s is not implementation evidence', (name, setup) => {
  const call = name === 'callable parameter'
    ? 'function g(cb:()=>uint8):uint8{return cb();}g(f);'
    : 'function g():uint8{return f();}g();';
  const result = observe(setup + call);
  expect(result).toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
  expect(result.message).toContain('uint.<8>');
});

test.each(['box.f()', '(box.f)()', 'box.f?.()', 'box?.f()'])('replaced %s retains receiving admission', (call) => {
  expect(observe(`class C{f():uint8{return 1;}}const box=new C();const erased:any=box;erased.f=()=>"bad";function g():uint8{return ${call};}g();`))
    .toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
});

test.each(['eval', '(eval)', '((eval))'])('%s can replace a captured local callee', (callee) => {
  expect(observe(`function outer(){function f():uint8{return 1;}function g():uint8{return f();}${callee}("f=()=>\\"bad\\"");return g();}outer();`))
    .toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
});

test.each(['return f();', 'return (f)();', 'const n:uint8=f();return n;'])('shallow immutable storage retains the boundary in %s', (body) => {
  expect(observe(`function bad(){return "bad";}const f:()=>uint8=bad;function g():uint8{${body}}g();`))
    .toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
});

test('a known global property write withdraws the declaration result assumption', () => {
  expect(observe('function f():string{return "old";}globalThis.f=()=>1;const x:number=f();String(x);'))
    .toMatchObject({ bodyEntered: true, completion: 'normal', value: '1', errorClass: undefined });
});

test('a later Script cannot exploit an earlier elided return', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(realm.evaluateScriptSkipDebugger('function f():uint8{return 1;}function g():uint8{return f();}').Type).toBe('normal');
  const changed = realm.evaluateScriptSkipDebugger('globalThis.f=()=>"bad";g();');
  expect(changed.Type).toBe('throw');
  expect((changed.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString).toContain('uint.<8>');
});

test.each(['false', 'true'])('callee capture, receiver and fallback execute once (invalid = %s)', (invalid) => {
  const source = `let log="";const old=function(x){log+="call,";if(this.tag!==7)throw Error("receiver");return ${invalid} ? "bad" : x;};
    const box:{readonly tag:number,readonly f:(number)=>uint8}={tag:7,get f(){log+="get,";return old;}};
    function argument(){log+="arg,";Object.defineProperty(box,"f",{value:()=>{log+="replacement,";return "wrong";}});return 1;}
    log="";try{const n:uint8=box.f(argument());log+="ok,";}catch(e){log+=e.name+",";}log;`;
  expect(observe(source)).toMatchObject({ bodyEntered: true, completion: 'normal',
    value: invalid === 'true' ? 'get,arg,call,TypeError,' : 'get,arg,call,ok,' });
});

test('a thrown argument prevents invocation and receiving admission', () => {
  expect(observe('let log="";const box:{readonly f:(number)=>uint8}={get f(){log+="get,";return function(){log+="call,";return "bad";};}};function argument(){log+="arg,";throw Error("stop");}log="";try{const n:uint8=box.f(argument());}catch(e){log+=e.message;}log;'))
    .toMatchObject({ bodyEntered: true, completion: 'normal', value: 'get,arg,stop' });
});

test('optional short-circuiting skips arguments and invocation', () => {
  expect(observe('let calls=0;function invoke(f:((number)=>uint8)|undefined){return f?.(calls++);}invoke(undefined);String(calls);'))
    .toMatchObject({ bodyEntered: true, completion: 'normal', value: '0' });
});

test('a tagged call does not bypass a declared return', () => {
  expect(observe('function bad(){return "bad";}const f:(any)=>uint8=bad;function g():uint8{return f`text`;}g();'))
    .toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
});

test.each([
  'let current:any=(1:=uint8);const box:{readonly x:uint8}={get x(){return current;}};current="bad";',
  'class C{get x():uint8{return 1;}}const box=new C();Object.defineProperty(box,"x",{value:"bad"});',
])('a property view retains admission after descriptor or value replacement: %s', (setup) => {
  expect(observe(`${setup}function g():uint8{return box.x;}g();`))
    .toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
});

test('sloppy eval can hide an outer immutable callable', () => {
  expect(observe('const f=():uint8=>1;function outer(){type Checked=string;eval("var f=function(){return \\"bad\\";}");function g():uint8{return f();}return g();}outer();'))
    .toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
});

test('super property lookup retains admission after a prototype descriptor change', () => {
  expect(observe('class Base{get x():uint8{return 1;}}class Derived extends Base{g():uint8{return super.x;}}Object.defineProperty(Base.prototype,"x",{value:"bad"});new Derived().g();'))
    .toMatchObject({ bodyEntered: true, completion: 'throw', errorClass: 'TypeError' });
});

test.each([
  'const f=():uint8=>1;function g():uint8{return f();}String(g());',
  'function outer(){function f():uint8{return 1;}function g():uint8{return f();}return String(g());}outer();',
  'const f=():uint8=>1;const saved=f;function g():uint8{return saved();}String(g());',
])('an established implementation retains its ordinary result: %s', (source) => {
  expect(observe(source)).toMatchObject({ bodyEntered: true, completion: 'normal', value: '1' });
});

test('an isolated declared implementation preserves proven structural elision', () => {
  expect(observe('function outer(){let reads=0;const box={get x(){reads++;return(1:=uint8);}};const f=(s:{readonly x:uint8}):{readonly x:uint8}=>{reads=0;return s;};const n:{readonly x:uint8}=f(box);return String(reads);}outer();'))
    .toMatchObject({ bodyEntered: true, completion: 'normal', value: '0' });
});

test('exported replacement decoration cannot authorize return elision', async () => {
  expect(await observeModuleGraph({
    main: 'function decorate(ctx){return function(){return "bad";};}@decorate export function f():uint8{return 1;}function g():uint8{return f();}g();',
  })).toMatchObject({ status: 'rejected', bodyEntries: ['main'], errorClass: 'TypeError' });
});
