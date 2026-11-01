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

test.each(['target.__proto__=proto', 'target["__proto__"]=proto'])('%s retains a later inherited invocation', (write) => {
  expect(observe('const target={};const proto={run(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}${write};target.run();const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['const target={};', ''])('ordinary legacy relinking preserves an intermediate capture (%s)', (local) => {
  expect(observe(`${local ? '' : 'const target={};'}const proto={run(){globalThis.f=()=>1;}};`,
    `function f():string{return "old";}${local}target.__proto__=proto;const before=f;target.run();const n:number=before();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('legacy relinking does not invoke an unused prototype getter', () => {
  expect(observe('const target={};const proto={get unused(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}target.__proto__=proto;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a saved original legacy setter preserves a capture between relinking and use', () => {
  expect(observe('const setter=Object.getOwnPropertyDescriptor(Object.prototype,"__proto__").set;const target={};const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}setter.call(target,proto);const before=f;target.run();const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a replacement inherited setter retains its actual effects and receiver', () => {
  expect(observe('let calls=0;Object.defineProperty(Object.prototype,"__proto__",{set(v){calls++;this.owner.f=()=>1;},configurable:true});',
    'function f():string{return "old";}const target={owner:globalThis};target.__proto__={};const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('an own data property named __proto__ does not relink', () => {
  expect(observe('const proto={get run(){globalThis.f=()=>1;return ()=>0;}};',
    'function f():string{return "old";}const target={["__proto__"]:0};target.__proto__=proto;target.run;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

const setterSetup = 'const setter=Object.getOwnPropertyDescriptor(Object.prototype,"__proto__").set;';
const routes = [
  'target.__proto__=proto', 'Reflect.set(target,"__proto__",proto)', 'Object.assign(target,{["__proto__"]:proto})',
  'setter.call(target,proto)', 'setter.apply(target,[proto])', 'setter.bind(target)(proto)',
];

test.each(routes)('%s separates relinking from an unused inherited getter', (write) => {
  expect(observe(`${setterSetup}const target={};const proto={get unused(){globalThis.f=()=>1;return 0;}};`,
    `function f():string{return "old";}${write};const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(routes)('%s preserves a capture before inherited invocation', (write) => {
  expect(observe(`${setterSetup}const target={};const proto={run(){globalThis.f=()=>1;}};`,
    `function f():string{return "old";}${write};const before=f;target.run();const n:number=before();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['target.__proto__=proto', 'Reflect.set(target,"__proto__",proto)', 'Object.assign(target,{["__proto__"]:proto})'])('%s invokes an inherited source setter with its receiver', (write) => {
  expect(observe('let calls=0;',
    `function f():string{return "old";}const parent={set __proto__(v){calls++;this.owner.f=()=>1;}};const target={__proto__:parent,owner:globalThis};const proto={};${write};const n:number=f();String(calls)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('the original setter summary follows a renamed accessor', () => {
  expect(observe(`${setterSetup}const parent={};Object.defineProperty(parent,"link",{set:setter});const target=Object.create(parent);const proto={run(){globalThis.f=()=>1;}};`,
    'function f():string{return "old";}target.link=proto;const before=f;target.run();const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a saved setter keeps its identity after the original property is replaced', () => {
  expect(observe(`${setterSetup}Object.defineProperty(Object.prototype,"__proto__",{set(){throw "replacement";},configurable:true});const target={};const proto={run(){globalThis.f=()=>1;}};`,
    'function f():string{return "old";}setter.call(target,proto);const before=f;target.run();const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an own ordinary setter with the legacy name remains an ordinary callback', () => {
  expect(observe('let calls=0;',
    'function f():string{return "old";}const target={owner:globalThis,set __proto__(v){calls++;this.owner.f=()=>1;}};target.__proto__={};const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(['1', 'undefined', '"ignored"'])('the original setter ignores primitive prototype %s before an exotic receiver', (value) => {
  expect(observe(`${setterSetup}const target=new Proxy({},{setPrototypeOf(){globalThis.f=()=>1;return true;}});`,
    `function f():string{return "old";}setter.call(target,${value});const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('the original setter keeps the exotic receiver operation for an object prototype', () => {
  expect(observe(`${setterSetup}let calls=0;const target=new Proxy({},{setPrototypeOf(){calls++;globalThis.f=()=>1;return true;}});`,
    'function f():string{return "old";}setter.call(target,{});const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a proxy used only as the new prototype is not probed at relinking', () => {
  expect(observe('const target={};const proto=new Proxy({},{getPrototypeOf(){globalThis.f=()=>1;return null;},get(){globalThis.f=()=>1;}});',
    'function f():string{return "old";}target.__proto__=proto;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a later lookup through a proxy prototype runs its trap once', () => {
  expect(observe('let calls=0;const target={};const proto=new Proxy({},{get(){calls++;globalThis.f=()=>1;return ()=>0;}});',
    'function f():string{return "old";}target.__proto__=proto;target.run();const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('Reflect.set changes the supplied receiver through the inherited setter', () => {
  expect(observe('const target={};const receiver={};const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}Reflect.set(target,"__proto__",proto,receiver);const before=f;receiver.run();const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('right-hand-side replacement participates before setter selection', () => {
  expect(observe('let calls=0;function replacement(v){calls++;globalThis.f=()=>1;}const target={};',
    'function f():string{return "old";}target.__proto__=(Object.defineProperty(Object.prototype,"__proto__",{set:replacement,configurable:true}),{});const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('right-hand-side relinking participates before setter selection', () => {
  expect(observe('let calls=0;const custom={set __proto__(v){calls++;globalThis.f=()=>1;}};const target={};',
    'function f():string{return "old";}target.__proto__=(Object.setPrototypeOf(target,custom),{});const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('deleting an own data property exposes the inherited setter', () => {
  expect(observe('const target={["__proto__"]:0};const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}delete target.__proto__;target.__proto__=proto;const before=f;target.run();const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a null-prototype target stores an own property instead of finding the legacy setter', () => {
  expect(observe('const proto={get run(){globalThis.f=()=>1;return ()=>0;}};',
    'function f():string{return "old";}const target={__proto__:null};target.__proto__=proto;target.run;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('relinking one allocation does not change another allocation', () => {
  expect(observe('const proto={get run(){globalThis.f=()=>1;return ()=>0;}};',
    'function f():string{return "old";}const a={};const b={};a.__proto__=proto;b.run;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a throwing setter neither replays the right-hand side nor reaches later statements', () => {
  expect(observe('let rhs=0;let calls=0;const target={set __proto__(v){calls++;globalThis.f=()=>1;throw new Error("stop");}};',
    'function f():string{return "old";}try{target.__proto__=(rhs++,{});rhs+=100;}catch{}const n:number=f();String(rhs)+":"+String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1:1' });
});

test('an incompatible replacement result still fails at its receiving boundary', () => {
  expect(observe('const target={};const proto={run(){globalThis.f=()=>false;}};',
    'function f():string{return "old";}target.__proto__=proto;target.run();const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('an inherited array index setter remains an effect of the store', () => {
  expect(observe('let calls=0;Object.defineProperty(Array.prototype,"0",{set(v){calls++;globalThis.f=()=>1;},configurable:true});',
    'function f():string{return "old";}const target=[];target[0]=1;const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('an ordinary new array index does not invent an ambient effect', () => {
  expect(observe('', 'function f():string{return "old";}const target=[];target[0]=1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an own typed data property with the legacy name retains admission effects', () => {
  expect(observe('let calls=0;const target={};Object.defineProperty(target,"__proto__",{type:type {x:number},value:{x:0},writable:true});const candidate={get x(){calls++;globalThis.f=()=>1;return 1;}};',
    'function f():string{return "old";}target.__proto__=candidate;const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('an explicit Reflect.set receiver does not relink its lookup target', () => {
  expect(observe('const proto={get run(){globalThis.f=()=>1;return ()=>0;}};',
    'function f():string{return "old";}const target={};const receiver={};Reflect.set(target,"__proto__",proto,receiver);target.run;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a possible bound callee does not cancel an unknown contributing callee', () => {
  expect(observe(`${setterSetup}const target={};const flag=false;function other(p){p.unused;}const proto={get unused(){globalThis.f=()=>1;return 0;}};`,
    'function f():string{return "old";}const op=flag?setter.bind(target):(other||(()=>{}));op(proto);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an explicitly typed source property retains later admission effects', () => {
  expect(observe('let calls=0;const candidate={get x(){calls++;globalThis.f=()=>1;return 1;}};',
    'function f():string{return "old";}const target={(item:{x:number}):{x:0}};target.item=candidate;const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('Reflect.set observes a typed receiving property on a different receiver', () => {
  expect(observe('let calls=0;const receiver={};Object.defineProperty(receiver,"item",{type:type {x:number},value:{x:0},writable:true});const candidate={get x(){calls++;globalThis.f=()=>1;return 1;}};',
    'function f():string{return "old";}Reflect.set({},"item",candidate,receiver);const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('Reflect.set retains a different receiver proxy definition trap', () => {
  expect(observe('let calls=0;const receiver=new Proxy({},{defineProperty(){calls++;globalThis.f=()=>1;return true;}});',
    'function f():string{return "old";}Reflect.set({},"item",1,receiver);const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('Reflect.set stores capability flow on the receiver', () => {
  expect(observe('',
    'function f():string{return "old";}const receiver={};Reflect.set({},"world",globalThis,receiver);receiver.world.f=()=>1;const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('Reflect.set can write a global receiver through a different lookup target', () => {
  expect(observe('',
    'function f():string{return "old";}Reflect.set({},"f",()=>1,globalThis);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an assignment returns its right-hand value while the setter call returns undefined', () => {
  expect(observe(`${setterSetup}const target={};const proto={};`,
    'const assigned=(target.__proto__=proto);const called=setter.call(target,null);String(assigned===proto)+":"+String(called===undefined)+":"+String(Object.getPrototypeOf(target)===null);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:true:true' });
});

test('a foreign-realm original setter keeps its summary after replacement', () => {
  expect(observe('const target={};const proto={get unused(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}original.call(target,proto);const n:number=f();', (realm) => {
      const foreign = new ManagedRealm();
      const original = foreign.Intrinsics['%Object.prototype%'].properties.get(Value('__proto__'))!.Setter!;
      expect(EnsureCompletion(foreign.evaluateScriptSkipDebugger('Object.defineProperty(Object.prototype,"__proto__",{set(){throw "replacement";},configurable:true});')).Type).toBe('normal');
      realm.GlobalObject.properties.set(Value('original'), Descriptor({ Value: original, Writable: Value.true, Configurable: Value.true }));
    })).toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('using the global object as a legacy prototype does not itself write it', () => {
  expect(observe('const target={};',
    'function f():string{return "old";}target.__proto__=globalThis;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an ordinary source setter writing another global name preserves independent evidence', () => {
  expect(observe('var g=0;',
    'function f():string{return "old";}const target={set link(v){globalThis.g=v;}};target.link=1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an ordinary receiver alternative does not cancel an unknown receiver', () => {
  expect(observe(`${setterSetup}const flag=false;let calls=0;const proxy=new Proxy({},{setPrototypeOf(){calls++;globalThis.f=()=>1;return true;}});`,
    'function f():string{return "old";}const target=flag?{}:(proxy||{});setter.call(target,{});const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('an ignored primitive prototype alternative does not cancel a valid prototype alternative', () => {
  expect(observe(`${setterSetup}const flag=false;let calls=0;const target=new Proxy({},{setPrototypeOf(){calls++;globalThis.f=()=>1;return true;}});`,
    'function f():string{return "old";}const proto=flag?1:{};setter.call(target,proto);const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('deletion on an intermediate prototype exposes the original setter', () => {
  expect(observe('const middle={};Object.defineProperty(middle,"__proto__",{value:0,writable:true,configurable:true});const target=Object.create(middle);const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}delete middle.__proto__;target.__proto__=proto;const before=f;target.run();const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});
