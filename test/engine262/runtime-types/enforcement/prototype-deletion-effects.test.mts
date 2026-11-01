import { expect, test } from 'vitest';
import { Agent, EnsureCompletion, ManagedRealm, ObjectValue, setSurroundingAgent } from '#self';

/** Observe only the consuming Script; do not prepend code or invoke a probe getter. */
function observe(setup: string, source: string, initialize?: (realm: ManagedRealm) => void) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  initialize?.(realm);
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

const adapters = [
  ['call', 'null,{},"x",{value:0}'],
  ['apply', 'null,[{},"x",{value:0}]'],
  ['bind', 'null,{},"x"'],
];

test.each(adapters)('deleting an own %s exposes the actual inherited replacement', (name, args) => {
  expect(observe(`const target=Object.defineProperty;target.${name}=Function.prototype.${name};Object.setPrototypeOf(target,{${name}(){globalThis.f=()=>1;}});`,
    `function f():string{return "old";}delete target.${name};target.${name}(${args});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(adapters)('Reflect.deleteProperty exposes an inherited %s replacement', (name, args) => {
  expect(observe(`const target=Object.defineProperty;target.${name}=Function.prototype.${name};Object.setPrototypeOf(target,{${name}(){globalThis.f=()=>1;}});`,
    `function f():string{return "old";}Reflect.deleteProperty(target,"${name}");target.${name}(${args});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('deleting a namespace method exposes its inherited replacement', () => {
  expect(observe('Object.setPrototypeOf(Object,{defineProperty(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}delete Object.defineProperty;Object.defineProperty({},"x",{value:0});const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an unrelated deletion does not expose a shadowed adapter', () => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;target.extra=0;Object.setPrototypeOf(target,{call(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}delete target.extra;target.call(null,{},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an argument-side deletion does not change the captured adapter', () => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;Object.setPrototypeOf(target,{call(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}target.call(null,{},"x",(delete target.call,{value:0}));const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});


test.each([
  ['parenthesized', 'delete (target.call);'],
  ['computed', 'delete target["call"];'],
  ['optional', 'delete target?.call;'],
  ['aliased', 'const alias=target;delete alias.call;'],
  ['borrowed reflective helper', 'Reflect.deleteProperty.call(null,target,"call");'],
  ['applied reflective helper', 'Reflect.deleteProperty.apply(null,[target,"call"]);'],
  ['bound reflective helper', 'const remove=Reflect.deleteProperty.bind(null,target,"call");remove();'],
  ['unknown deletion key', 'const key=flag?"call":"extra";delete target[key];'],
])('%s deletion retains the newly exposed method effects', (_name, operation) => {
  expect(observe('const flag=true;const target=Object.defineProperty;target.call=Function.prototype.call;Object.setPrototypeOf(target,{call(){globalThis.f=()=>1;}});',
    `function f():string{return "old";}${operation}target.call(null,{},"x",{value:0});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an inherited adapter getter runs once at the read after deletion', () => {
  expect(observe('let log="";const target=Object.defineProperty;target.call=Function.prototype.call;Object.setPrototypeOf(target,{get call(){log+="get,";globalThis.f=()=>1;return function(){log+="invoke,";};}});',
    'function f():string{return "old";}delete target.call;log+="deleted,";target.call((log+="arg,",null));const n:number=f();log+n;'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'deleted,get,arg,invoke,1' });
});

test('a throwing inherited getter skips arguments and is not replayed', () => {
  expect(observe('let gets=0,args=0;const target=Object.defineProperty;target.call=Function.prototype.call;Object.setPrototypeOf(target,{get call(){gets++;globalThis.f=()=>1;throw "stop";}});',
    'function f():string{return "old";}delete target.call;let caught="";try{target.call((args++,null));}catch(e){caught=e;}const n:number=f();caught+":"+gets+":"+args+":"+n;'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'stop:1:0:1' });
});

test('deletion alone does not read an own or inherited getter', () => {
  expect(observe('const target=Object.defineProperty;Object.defineProperty(target,"call",{get(){globalThis.f=()=>1;},configurable:true});Object.setPrototypeOf(target,{get call(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}delete target.call;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a non-configurable own method still hides its inherited replacement', () => {
  expect(observe('const target=Object.defineProperty;Object.defineProperty(target,"call",{value:Function.prototype.call,configurable:false});Object.setPrototypeOf(target,{call(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}Reflect.deleteProperty(target,"call");target.call(null,{},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a captured original adapter survives later property deletion', () => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;Object.setPrototypeOf(target,{call(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}const original=target.call;delete target.call;original.call(target,null,{},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('deleting a non-reference expression does not remove the property', () => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;Object.setPrototypeOf(target,{call(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}delete (0,target.call);target.call(null,{},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a null optional deletion has no lookup effect', () => {
  expect(observe('', 'function f():string{return "old";}delete null?.call;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an inherited replacement still meets the receiving boundary', () => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;Object.setPrototypeOf(target,{call(){globalThis.f=()=>"bad";}});',
    'function f():number{return 1;}delete target.call;target.call();const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('deletion on an intermediate prototype can reveal a deeper method', () => {
  expect(observe('const target=Object.defineProperty;const middle={call:Function.prototype.call};Object.setPrototypeOf(middle,{call(){globalThis.f=()=>1;}});Object.setPrototypeOf(target,middle);',
    'function f():string{return "old";}delete middle.call;target.call(null,{},"x",{value:0});const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a current-source inherited getter receives the original target', () => {
  expect(observe('let reads=0;const target=Object.defineProperty;target.owner=globalThis;target.call=Function.prototype.call;const proto={call:Function.prototype.call};Object.setPrototypeOf(target,proto);',
    'function f():string{return "old";}Object.defineProperty(proto,"call",{get(){reads++;this.owner.f=()=>1;return ()=>0;}});delete target.call;target.call();const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('deleting a source aggregate property withdraws an unavailable prototype proof', () => {
  expect(observe('Object.prototype.call=function(){globalThis.f=()=>1;};',
    'function f():string{return "old";}const target={call(){}};delete target.call;target.call();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('deleting a source array index exposes possible inherited apply-list access', () => {
  expect(observe('Object.defineProperty(Array.prototype,"0",{get(){globalThis.f=()=>1;return 0;},set(v){},configurable:true});',
    'function f():string{return "old";}function target(){}const args=[0];delete args[0];target.apply(null,args);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a deletion revealing the original inherited adapter preserves evidence', () => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;',
    'function f():string{return "old";}delete target.call;target.call(null,{},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('deletion on a distinct allocation does not expose the target prototype', () => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;Object.setPrototypeOf(target,{call(){globalThis.f=()=>1;}});const other={call:0};',
    'function f():string{return "old";}delete other.call;target.call(null,{},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});


test('a parenthesized deletion does not read its own getter', () => {
  expect(observe('const target={get call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}delete (target.call);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a nested optional deletion evaluates its intermediate getter once', () => {
  expect(observe('let reads=0;const container={get target(){reads++;globalThis.f=()=>1;return {call(){}};}};',
    'function f():string{return "old";}delete container?.target.call;const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});
