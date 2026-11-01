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

test.each(adapters)('a replaced intrinsic target %s property is an ordinary call', (name, args) => {
  expect(observe(`const target=Object.defineProperty;target.${name}=function(){globalThis.f=()=>1;};`,
    `function f():string{return "old";}target.${name}(${args});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(adapters)('a replaced Function.prototype.%s is observed by a source function', (name, args) => {
  expect(observe(`Function.prototype.${name}=function(){globalThis.f=()=>1;};`,
    `function f():string{return "old";}function target(){}target.${name}(${args});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(adapters)('a current-source own %s property receives the actual function receiver', (name, args) => {
  expect(observe('',
    `function f():string{return "old";}function target(){}target.owner=globalThis;target.${name}=function(){this.owner.f=()=>1;};target.${name}(${args});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['call via call', 'Function.prototype.call.call(Object.defineProperty,null,{},"x",{value:0});'],
  ['apply via call', 'Function.prototype.apply.call(Object.defineProperty,null,[{},"x",{value:0}]);'],
  ['call via apply', 'Function.prototype.call.apply(Object.defineProperty,[null,{},"x",{value:0}]);'],
  ['renamed call', 'target.invoke(null,{},"x",{value:0});'],
  ['binding is not invocation', 'const bound=Object.defineProperty.bind(null,globalThis,"f",{value:()=>1});'],
  ['null apply list', 'function target(){}target.apply(null,null);'],
])('%s preserves independent result evidence', (_name, operation) => {
  expect(observe('const target=Object.defineProperty;target.invoke=Function.prototype.call;',
    `function f():string{return "old";}${operation}const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each([
  ['call via call', 'Function.prototype.call.call(Reflect.set,null,globalThis,"f",()=>1);'],
  ['apply via call', 'Function.prototype.apply.call(Reflect.set,null,[globalThis,"f",()=>1]);'],
  ['call via apply', 'Function.prototype.call.apply(Reflect.set,[null,globalThis,"f",()=>1]);'],
  ['bound invocation', 'const bound=Reflect.set.bind(null,globalThis,"f");bound(()=>1);'],
])('%s forwards the actual operation effects', (_name, operation) => {
  expect(observe('', `function f():string{return "old";}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an original adapter captured under another property survives prototype replacement', () => {
  expect(observe('const target=Object.defineProperty;target.invoke=Function.prototype.call;Function.prototype.call=function(){globalThis.f=()=>1;};',
    'function f():string{return "old";}target.invoke(null,{},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['call','apply','bind'])('a %s getter runs once before arguments', (name) => {
  expect(observe(`let log="";const target=Object.defineProperty;Object.defineProperty(target,"${name}",{get(){log+="get,";return function(){log+="invoke,";globalThis.f=()=>1;};}});`,
    `function f():string{return "old";}target.${name}((log+="arg,",null),[]);const n:number=f();log+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'get,arg,invoke,1' });
});

test.each(['length','name'])('binding reads target %s metadata without invoking the target', (property) => {
  expect(observe(`let reads=0;const target=Object.defineProperty;Object.defineProperty(target,"${property}",{get(){reads++;globalThis.f=()=>1;return ${property==='length'?'3':'"target"'};}});`,
    'function f():string{return "old";}target.bind(null);const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('apply reads list elements even when a local target declares no parameters', () => {
  expect(observe('let reads=0;const args={length:1,get 0(){reads++;globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}function target(){}target.apply(null,args);const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a throwing adapter getter skips arguments and is not replayed', () => {
  expect(observe('let gets=0,args=0;const target=Object.defineProperty;Object.defineProperty(target,"bind",{get(){gets++;globalThis.f=()=>1;throw "stop";}});',
    'function f():string{return "old";}let caught="";try{target.bind((args++,null));}catch(e){caught=e;}const n:number=f();caught+":"+gets+":"+args+":"+n;'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'stop:1:0:1' });
});

test('a replacement adapter cannot bypass a receiving check', () => {
  expect(observe('const target=Object.defineProperty;target.bind=function(){globalThis.f=()=>"bad";};',
    'function f():number{return 1;}target.bind(null);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test.each([
  ['bind via call', 'const bound=Function.prototype.bind.call(Reflect.set,null,globalThis,"f");bound(()=>1);'],
  ['bind via apply', 'const bound=Function.prototype.bind.apply(Reflect.set,[null,globalThis,"f"]);bound(()=>1);'],
  ['spread bind', 'const prefix=[null,globalThis,"f"];const bound=Reflect.set.bind(...prefix);bound(()=>1);'],
  ['bound call', 'const bound=Reflect.set.bind(null,globalThis,"f");bound.call(null,()=>1);'],
  ['bound apply', 'const bound=Reflect.set.bind(null,globalThis,"f");bound.apply(null,[()=>1]);'],
  ['computed call', 'Reflect.set["call"](null,globalThis,"f",()=>1);'],
  ['optional call', 'Reflect.set?.call(null,globalThis,"f",()=>1);'],
])('%s retains captured and forwarded effects', (_name, operation) => {
  expect(observe('', `function f():string{return "old";}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a borrowed bind captures an opaque target without invoking it', () => {
  expect(observe('const target=()=>{globalThis.f=()=>1;};',
    'function f():string{return "old";}const bound=Function.prototype.bind.apply(target,[null,0]);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a bound function retains the target prototype for adapter lookup', () => {
  expect(observe('const target=Object.defineProperty;Object.setPrototypeOf(target,{call(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}const bound=Function.prototype.bind.call(target,null);bound.call();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a bound function can have an ordinary own adapter property', () => {
  expect(observe('',
    'function f():string{return "old";}function target(){}const bound=target.bind(null);bound.owner=globalThis;bound.call=function(){this.owner.f=()=>1;};bound.call();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an inherited adapter getter receives the original function', () => {
  expect(observe('let reads=0;Object.defineProperty(Function.prototype,"call",{get(){reads++;this.owner.f=()=>1;return ()=>0;}});',
    'function f():string{return "old";}function target(){}target.owner=globalThis;target.call();const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a bind proxy prototype trap is an effect before target invocation', () => {
  expect(observe('let reads=0;const target=new Proxy(Object.defineProperty,{getPrototypeOf(t){reads++;globalThis.f=()=>1;return Reflect.getPrototypeOf(t);}});',
    'function f():string{return "old";}const bound=Function.prototype.bind.call(target,null);const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('apply consumes elements exposed by a current-source length change', () => {
  expect(observe('let reads=0;const args={length:0,get 0(){reads++;globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}function target(){}args.length=1;target.apply(null,args);const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('apply ignores non-index getters outside its fixed empty argument list', () => {
  expect(observe('const args={length:0,get extra(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}function target(){}target.apply(null,args);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an ordinary non-callable container can supply a property named bind', () => {
  expect(observe('const target={bind(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}target.bind();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('reading an adapter data property does not invoke it', () => {
  expect(observe('const target=Object.defineProperty;target.bind=()=>{globalThis.f=()=>1;};',
    'function f():string{return "old";}const adapter=target.bind;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});


test.each([
  ['call', 'bound.call(null,{value:0});'],
  ['apply', 'bound.apply(null,[{value:0}]);'],
])('an original bound %s preserves independent evidence', (_name, operation) => {
  expect(observe('',
    `function f():string{return "old";}const bound=Object.defineProperty.bind(null,{},"x");${operation}const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});
