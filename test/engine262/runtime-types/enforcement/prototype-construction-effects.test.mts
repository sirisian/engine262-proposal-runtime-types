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

test.each(['Object.create(proto)', '({__proto__:proto})'])('%s does not invoke an unused inherited getter during construction', (creation) => {
  expect(observe('const proto={get unused(){globalThis.f=()=>1;return 0;}};',
    `function f():string{return "old";}const target=${creation};const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['Object.create(proto)', '({__proto__:proto})'])('%s retains effects of a later inherited call', (creation) => {
  expect(observe('const proto={run(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}const target=${creation};target.run();const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object.create(proto)', '({__proto__:proto})'])('%s preserves a capture between construction and inherited invocation', (creation) => {
  expect(observe('const proto={run(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}const target=${creation};const before=f;target.run();const n:number=before();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a default object-literal prototype can supply an inherited getter', () => {
  expect(observe('Object.defineProperty(Object.prototype,"run",{get(){globalThis.f=()=>1;return ()=>0;},configurable:true});',
    'function f():string{return "old";}const target={};target.run();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a null literal prototype excludes Object.prototype access', () => {
  expect(observe('Object.defineProperty(Object.prototype,"run",{get(){globalThis.f=()=>1;return ()=>0;},configurable:true});',
    'function f():string{return "old";}const target={__proto__:null};target.run;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['({__proto__:proto})', '({"__proto__":proto})', 'Object.create(proto)'])('%s preserves the receiver of a source inherited getter', (creation) => {
  expect(observe('let reads=0;',
    `function f():string{return "old";}const proto={get run(){reads++;this.owner.f=()=>1;return ()=>0;}};const target=${creation};target.owner=globalThis;target.run();const n:number=f();String(reads)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(['null', 'n', 'false?{}:n'])('literal prototype %s preserves a null chain', (value) => {
  expect(observe('const n=null;Object.defineProperty(Object.prototype,"run",{get(){globalThis.f=()=>1;return ()=>0;},configurable:true});',
    `function f():string{return "old";}const target={__proto__:${value}};target.run;const result:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['1', 'undefined', 'n'])('literal prototype %s retains the default chain when ignored', (value) => {
  expect(observe('const n=1;Object.defineProperty(Object.prototype,"run",{get(){globalThis.f=()=>1;return ()=>0;},configurable:true});',
    `function f():string{return "old";}const target={__proto__:${value}};target.run();const result:number=f();String(result);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object.create(proto)', '({__proto__:proto})'])('%s does not run traps just to install a proxy prototype', (creation) => {
  expect(observe('const proto=new Proxy({},{getPrototypeOf(){globalThis.f=()=>1;return null;},get(){globalThis.f=()=>1;}});',
    `function f():string{return "old";}const target=${creation};const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['Object.create(proto)', '({__proto__:proto})'])('%s accounts for a later proxy read exactly once', (creation) => {
  expect(observe('let reads=0;const proto=new Proxy({},{get(){reads++;globalThis.f=()=>1;return ()=>0;}});',
    `function f():string{return "old";}const target=${creation};target.run();const n:number=f();String(reads)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(['Object.create(false?{}:(proto||{}))', '({__proto__:false?{}:(proto||{})})'])('%s retains unknown contributing prototype expressions', (creation) => {
  expect(observe('const proto={run(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}const target=${creation};target.run();const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object.create.call(null,proto)', 'Object.create.apply(null,[proto])', 'Object.create.bind(null,proto)()'])('%s forwards the prototype through adapters', (creation) => {
  expect(observe('const proto={run(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}const target=${creation};const before=f;target.run();const n:number=before();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a replaced create helper retains replacement effects', () => {
  expect(observe('Object.create=function(){globalThis.f=()=>1;return {};};',
    'function f():string{return "old";}Object.create(null);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a saved original create helper retains its identity after replacement', () => {
  expect(observe('const create=Object.create;Object.create=function(){globalThis.f=()=>1;return {};};',
    'function f():string{return "old";}create(null);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('argument-side replacement does not retarget the captured create helper', () => {
  expect(observe('const replacement=function(){globalThis.f=()=>1;return {};};',
    'function f():string{return "old";}Object.create((Object.create=replacement,null));const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a descriptor-table getter runs once during creation', () => {
  expect(observe('let reads=0;const properties={get x(){reads++;globalThis.f=()=>1;return {value:0};}};',
    'function f():string{return "old";}Object.create(null,properties);const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a descriptor field getter runs during creation and keeps its receiver', () => {
  expect(observe('let reads=0;',
    'function f():string{return "old";}const base={get value(){reads++;this.owner.f=()=>1;return 0;}};const descriptor={__proto__:base,owner:globalThis};Object.create(null,{x:descriptor});const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a stored getter is not called just by creating its property', () => {
  expect(observe('const properties={x:{get(){globalThis.f=()=>1;return 0;}}};',
    'function f():string{return "old";}Object.create(null,properties);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a created getter retains effects at its later read', () => {
  expect(observe('let reads=0;const properties={x:{get(){reads++;globalThis.f=()=>1;return 0;}}};',
    'function f():string{return "old";}const target=Object.create(null,properties);target.x;const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a fresh own property hides a same-name inherited getter', () => {
  expect(observe('const proto={get x(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}const target=Object.create(proto,{x:{value:0}});target.x;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a source own method hides a same-name inherited method', () => {
  expect(observe('const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const target={__proto__:proto,run(){}};target.run();const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('deleting a configurable created property exposes the initial prototype', () => {
  expect(observe('const proto={get x(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}const target=Object.create(proto,{x:{value:0,configurable:true}});delete target.x;target.x;const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('later relinking participates in a created object lookup', () => {
  expect(observe('const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const target=Object.create(null);Object.setPrototypeOf(target,proto);target.run();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('separate creation sites retain distinct object identities', () => {
  expect(observe('const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const a=Object.create(null);const b=Object.create(null);Object.setPrototypeOf(a,proto);b.run;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['({["__proto__"]:proto})', '({__proto__})', '({__proto__(){return proto;}})'])('%s uses an ordinary own property rather than a prototype initializer', (creation) => {
  expect(observe('const proto={get run(){globalThis.f=()=>1;return 0;}};const __proto__=proto;',
    `const target=${creation};String(Object.getPrototypeOf(target)===Object.prototype)+":"+String(Object.hasOwn(target,"__proto__"));`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:true' });
});

test.each(['Object.create(proto)', '({__proto__:proto})'])('%s retains inherited setter effects at the store', (creation) => {
  expect(observe('const proto={set x(v){globalThis.f=()=>1;}};',
    `function f():string{return "old";}const target=${creation};target.x=0;const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object.create(proto)', '({__proto__:proto})'])('%s retains inherited coercion effects at the operation', (creation) => {
  expect(observe('const proto={[Symbol.toPrimitive](){globalThis.f=()=>1;return 0;}};',
    `function f():string{return "old";}const target=${creation};+target;const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an inherited getter throwing skips arguments and is never replayed', () => {
  expect(observe('let reads=0,args=0;const proto={get run(){reads++;globalThis.f=()=>1;throw "stop";}};',
    'function f():string{return "old";}const target=Object.create(proto);let caught="";try{target.run(args++);}catch(e){caught=e;}const n:number=f();caught+":"+reads+":"+args+":"+n;'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'stop:1:0:1' });
});

test('a wrong replacement result still fails at its receiving boundary', () => {
  expect(observe('const proto={run(){globalThis.f=()=>"bad";}};',
    'function f():number{return 1;}const target={__proto__:proto};target.run();const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('descriptor-table getters prevent an unconditional own-property proof', () => {
  expect(observe('const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const target=Object.create(proto,{get x(){delete this.run;return {value:0};},run:{value:()=>0}});target.run();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object.create(null,undefined)', 'Object.create.apply(null,[null,undefined])', 'Object.create(null,42)'])('%s does not invent descriptor callbacks for primitive arguments', (creation) => {
  expect(observe('', `function f():string{return "old";}${creation};const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('argument-side definition does not retarget a captured create helper', () => {
  expect(observe('const replacement=function(){globalThis.f=()=>1;return {};};',
    'function f():string{return "old";}Object.create((Object.defineProperty(Object,"create",{value:replacement}),null));const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a foreign-realm original create helper retains its summary', () => {
  expect(observe('', 'function f():string{return "old";}original(null);const n:number=f();', (realm) => {
    const foreign = new ManagedRealm();
    const original = foreign.Intrinsics['%Object%'].properties.get(Value('create'))!.Value!;
    expect(EnsureCompletion(foreign.evaluateScriptSkipDebugger('Object.create=function(){throw "replacement";};')).Type).toBe('normal');
    realm.GlobalObject.properties.set(Value('original'), Descriptor({ Value: original, Writable: Value.true, Configurable: Value.true }));
  })).toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('using the global object as a prototype does not itself expose a global write', () => {
  expect(observe('', 'function f():string{return "old";}Object.create(globalThis);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('the proposal type descriptor getter participates during creation', () => {
  expect(observe('let reads=0;const descriptor={get type(){reads++;globalThis.f=()=>1;return "uint8";}};',
    'function f():string{return "old";}Object.create(null,{x:descriptor});const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('typed descriptor admission keeps structural getter effects at creation', () => {
  expect(observe('let reads=0;const candidate={get x(){reads++;globalThis.f=()=>1;return 1;}};',
    'function f():string{return "old";}Object.create(null,{item:{type:type {x:number},value:candidate}});const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(['Object.defineProperty({},"item",descriptor)', 'Reflect.defineProperty({},"item",descriptor)', 'Object.defineProperties({},{item:descriptor})'])('%s retains typed descriptor getter effects', (definition) => {
  expect(observe('let reads=0;const descriptor={get type(){reads++;globalThis.f=()=>1;return "uint8";}};',
    `function f():string{return "old";}${definition};const n:number=f();String(reads)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(['Object.defineProperty({},"item",descriptor)', 'Reflect.defineProperty({},"item",descriptor)', 'Object.defineProperties({},{item:descriptor})'])('%s retains typed descriptor admission effects', (definition) => {
  expect(observe('let reads=0;const candidate={get x(){reads++;globalThis.f=()=>1;return 1;}};',
    `function f():string{return "old";}const descriptor={type:type {x:number},value:candidate};${definition};const n:number=f();String(reads)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('an unknown primitive key still observes a user getter on the default prototype', () => {
  expect(observe('const key="run";let reads=0;Object.defineProperty(Object.prototype,key,{get(){reads++;globalThis.f=()=>1;return 0;},configurable:true});',
    'function f():string{return "old";}const target={};target[key];const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('reading the original prototype getter on a fresh ordinary receiver preserves evidence', () => {
  expect(observe('', 'function f():string{return "old";}const target={};target.__proto__;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a replacement prototype getter does not inherit the original getter summary', () => {
  expect(observe('let reads=0;Object.defineProperty(Object.prototype,"__proto__",{get(){reads++;globalThis.f=()=>1;return null;},configurable:true});',
    'function f():string{return "old";}const target={};target.__proto__;const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a descriptor-table decorator cannot prove a removed own property is present', () => {
  expect(observe('function remove(c){delete c.objectContext.run;}const proto={run(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const target=Object.create(proto,@remove {run:{value(){}}});target.run();const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});
