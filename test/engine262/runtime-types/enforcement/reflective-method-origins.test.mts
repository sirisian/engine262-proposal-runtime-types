import { expect, test } from 'vitest';
import { Agent, Descriptor, EnsureCompletion, ManagedRealm, ObjectValue, Value, setSurroundingAgent } from '#self';

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

const replacements = [
  ['Object.defineProperty', '{},"x",{value:0}'],
  ['Object.defineProperties', '{},{x:{value:0}}'],
  ['Object.assign', '{},{x:0}'],
  ['Reflect.set', '{},"x",0'],
  ['Reflect.defineProperty', '{},"x",{value:0}'],
  ['Reflect.deleteProperty', '{},"x"'],
];

test.each(replacements)('a replaced %s has the replacement effects', (method, args) => {
  expect(observe(`${method}=function(){globalThis.f=()=>1;};`,
    `function f():string{return "old";}${method}(${args});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['direct', 'Object.defineProperty({},"x",{value:0});'],
  ['extracted', 'const define=Object.defineProperty;define({},"x",{value:0});'],
  ['destructured', 'const {defineProperty:define}=Object;define({},"x",{value:0});'],
  ['call', 'Object.defineProperty.call(null,{},"x",{value:0});'],
  ['apply', 'Object.defineProperty.apply(null,[{},"x",{value:0}]);'],
  ['bound', 'const define=Object.defineProperty.bind(null,{},"x");define({value:0});'],
  ['optional', 'Object.defineProperty?.({},"x",{value:0});'],
])('%s invocation retains replaced-method effects', (_name, operation) => {
  expect(observe('Object.defineProperty=function(){globalThis.f=()=>1;};',
    `function f():string{return "old";}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['Reflect.has', 'Reflect.has({},key);'],
  ['Reflect.getOwnPropertyDescriptor', 'Reflect.getOwnPropertyDescriptor({},key);'],
  ['Object.hasOwn', 'Object.hasOwn({},key);'],
  ['Object.getOwnPropertyDescriptor', 'Object.getOwnPropertyDescriptor({},key);'],
])('%s retains effects without a supported invocation summary', (_name, operation) => {
  expect(observe('const key={[Symbol.toPrimitive](){globalThis.f=()=>1;return "x";}};',
    `function f():string{return "old";}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(replacements)('a captured intrinsic %s keeps its summary', (method, args) => {
  expect(observe(`const original=${method};${method}=function(){globalThis.f=()=>1;};`,
    `function f():string{return "old";}original(${args});const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('the spelling of a different property is irrelevant to a captured intrinsic', () => {
  expect(observe('const box={other:Object.defineProperty};Object.defineProperty=function(){globalThis.f=()=>1;};',
    'function f():string{return "old";}box.other({},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an accessor replacing a reflective method is read once before arguments', () => {
  expect(observe('let log="";Object.defineProperty(Object,"defineProperty",{get(){log+="get,";return function(){log+="call,";globalThis.f=()=>1;};}});',
    'function f():string{return "old";}Object.defineProperty((log+="arg,",{}),"x",{value:0});const n:number=f();log+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'get,arg,call,1' });
});

test('a throwing method getter does not evaluate arguments or replay', () => {
  expect(observe('let gets=0,args=0;Object.defineProperty(Object,"defineProperty",{get(){gets++;globalThis.f=()=>1;throw "stop";}});',
    'function f():string{return "old";}let caught="";try{Object.defineProperty((args++,{}),"x",{value:0});}catch(e){caught=e;}const n:number=f();caught+":"+gets+":"+args+":"+n;'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'stop:1:0:1' });
});

test('a captured ordinary callee precedes an unknown reflective invocation', () => {
  expect(observe('Object.defineProperty=function(){globalThis.f=()=>1;};',
    'function f():string{return "old";}const before=f;Object.defineProperty({},"x",{value:0});const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('receiving checks reject a wrong replacement result', () => {
  expect(observe('Object.defineProperty=function(){globalThis.f=()=>"bad";};',
    'function f():number{return 1;}Object.defineProperty({},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test.each(replacements)('a foreign-realm intrinsic %s retains its own summary', (method, args) => {
  expect(observe('', `function f():string{return "old";}original(${args});const n:number=f();`, (realm) => {
    const foreign = new ManagedRealm();
    const [namespace, name] = method.split('.');
    const object = foreign.Intrinsics[namespace === 'Object' ? '%Object%' : '%Reflect%'];
    const original = object.properties.get(Value(name))!.Value!;
    expect(EnsureCompletion(foreign.evaluateScriptSkipDebugger(`${method}=function(){throw "replacement";};`)).Type).toBe('normal');
    realm.GlobalObject.properties.set(Value('original'), Descriptor({ Value: original, Writable: Value.true, Configurable: Value.true }));
  })).toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a proxy around a summarized intrinsic retains the proxy invocation effect', () => {
  expect(observe('let calls=0;Object.defineProperty=new Proxy(Object.defineProperty,{apply(){calls++;globalThis.f=()=>1;}});',
    'function f():string{return "old";}Object.defineProperty({},"x",{value:0});const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('reading an ordinary replacement data property does not invoke it', () => {
  expect(observe('Object.defineProperty=function(){globalThis.f=()=>1;};',
    'function f():string{return "old";}const unused=Object.defineProperty;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('argument-side reflective invocation does not retarget a captured callee', () => {
  expect(observe('Object.defineProperty=function(){globalThis.f=()=>1;};',
    'function f(...args):string{return "old";}const n:number=f(Object.defineProperty({},"x",{value:0}));'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a method getter effect precedes evaluation of its arguments', () => {
  expect(observe('const original=Object.defineProperty;Object.defineProperty(Object,"defineProperty",{get(){globalThis.f=()=>1;return original;}});',
    'function f():string{return "old";}function take(n:number){return {value:n};}Object.defineProperty({},"x",take(f()));const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Reflect.deleteProperty', 'original'])('%s retains a proxy target deletion effect', (callee) => {
  expect(observe('let calls=0;const original=Reflect.deleteProperty;const target=new Proxy({x:0},{deleteProperty(){calls++;globalThis.f=()=>1;return true;}});',
    `function f():string{return "old";}${callee}(target,"x");const n:number=f();String(calls)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});
