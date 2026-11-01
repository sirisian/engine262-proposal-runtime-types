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

const reads = [
  'Object.getOwnPropertyDescriptor(target,"run")',
  'Reflect.getOwnPropertyDescriptor(target,"run")',
  'Object.getOwnPropertyDescriptors(target).run',
];

test.each(reads)('%s observes an accessor without invoking it', (read) => {
  expect(observe('const target={get run(){globalThis.f=()=>1;return 0;}};',
    `function f():string{return "old";}const descriptor=${read};const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(reads)('%s retains effects of a later extracted getter call', (read) => {
  expect(observe('let calls=0;',
    `function f():string{return "old";}const target={get run(){calls++;this.world.f=()=>1;return 0;}};const descriptor=${read};descriptor.get.call({world:globalThis});const n:number=f();String(calls)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(reads)('%s preserves a capture between observation and invocation', (read) => {
  expect(observe('const target={get run(){globalThis.f=()=>1;return 0;}};',
    `function f():string{return "old";}const descriptor=${read};const before=f;descriptor.get();const n:number=before();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a same-source original legacy setter can be obtained without invoking it', () => {
  expect(observe('const target={};const proto={get unused(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}const original=Object.getOwnPropertyDescriptor(Object.prototype,"__proto__").set;original.call(target,proto);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an extracted data capability flows through its descriptor value', () => {
  expect(observe('',
    'function f():string{return "old";}const target={world:globalThis};const descriptor=Object.getOwnPropertyDescriptor(target,"world");descriptor.value.f=()=>1;const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('descriptor observation of a proxy retains its actual trap', () => {
  expect(observe('let calls=0;const target=new Proxy({},{getOwnPropertyDescriptor(){calls++;globalThis.f=()=>1;return undefined;}});',
    'function f():string{return "old";}Object.getOwnPropertyDescriptor(target,"run");const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(reads)('%s does not traverse an inherited getter', (read) => {
  expect(observe('const target=Object.create({get run(){globalThis.f=()=>1;return 0;}});',
    `function f():string{return "old";}const descriptor=${read};const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(reads)('%s returns a descriptor for a source setter without calling it', (read) => {
  expect(observe('let calls=0;',
    `function f():string{return "old";}const target={set run(v){calls++;this.world.f=()=>v;}};const descriptor=${read};descriptor.set.call({world:globalThis},1);const n:number=f();String(calls)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(reads)('%s captures data before a later store', (read) => {
  expect(observe('const replacement=()=>{globalThis.f=()=>1;return 0;};',
    `function f():string{return "old";}const target={run(){}};const descriptor=${read};target.run=replacement;descriptor.value();const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(reads)('%s captures an accessor before a later definition', (read) => {
  expect(observe('const replacement=()=>{globalThis.f=()=>1;return 0;};',
    `function f():string{return "old";}const target={get run(){return 0;}};const descriptor=${read};Object.defineProperty(target,"run",{get:replacement});descriptor.get();const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(reads)('%s includes accessor replacement before observation', (read) => {
  expect(observe('',
    `function f():string{return "old";}const target={get run(){return 0;}};Object.defineProperty(target,"run",{get(){globalThis.f=()=>1;return 0;}});const descriptor=${read};descriptor.get();const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('editing a returned descriptor does not edit the original property', () => {
  expect(observe('',
    'function f():string{return "old";}const target={world:{}};const descriptor=Object.getOwnPropertyDescriptor(target,"world");descriptor.value=globalThis;target.world.f=()=>1;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a descriptor data value retains the identity of its referenced object', () => {
  expect(observe('',
    'function f():string{return "old";}const target={world:globalThis};const descriptor=Object.getOwnPropertyDescriptors(target).world;descriptor.value.f=()=>1;const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object.getOwnPropertyDescriptor', 'Reflect.getOwnPropertyDescriptor'])('%s does not inspect an unrelated accessor', (read) => {
  expect(observe('const target={get unused(){globalThis.f=()=>1;return 0;},run:0};',
    `function f():string{return "old";}const descriptor=${read}(target,"run");const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('descriptor observation includes key coercion once', () => {
  expect(observe('let calls=0;const key={toString(){calls++;globalThis.f=()=>1;return "run";}};',
    'function f():string{return "old";}Object.getOwnPropertyDescriptor({run:0},key);const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('bulk descriptor observation retains a proxy ownKeys trap', () => {
  expect(observe('let calls=0;const target=new Proxy({},{ownKeys(){calls++;globalThis.f=()=>1;return [];}});',
    'function f():string{return "old";}Object.getOwnPropertyDescriptors(target);const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a getter while converting a proxy trap descriptor remains an effect', () => {
  expect(observe('let calls=0;const target=new Proxy({},{getOwnPropertyDescriptor(){return {get value(){calls++;globalThis.f=()=>1;return 0;},configurable:true};}});',
    'function f():string{return "old";}Reflect.getOwnPropertyDescriptor(target,"run");const n:number=f();String(calls)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(['Object.getOwnPropertyDescriptor','Reflect.getOwnPropertyDescriptor','Object.getOwnPropertyDescriptors'])('a replaced %s retains its implementation effects', (method) => {
  expect(observe(`${method}=function(){globalThis.f=()=>1;return {};};`,
    `function f():string{return "old";}${method}({},"run");const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object.getOwnPropertyDescriptor','Reflect.getOwnPropertyDescriptor'])('a saved %s original survives namespace replacement', (method) => {
  expect(observe(`const read=${method};${method}=function(){globalThis.f=()=>1;return {};};const target={get run(){globalThis.f=()=>1;}};`,
    'function f():string{return "old";}read(target,"run");const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['read.call(null,target,"run")','read.apply(null,[target,"run"])','read.bind(null,target)("run")'])('%s retains ordinary descriptor observation', (call) => {
  expect(observe('const read=Object.getOwnPropertyDescriptor;const target={get run(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}const descriptor=${call};const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a foreign original creates descriptor objects with its own realm prototype', () => {
  expect(observe('Object.defineProperty(foreignPrototype,"probe",{get(){globalThis.f=()=>1;return 0;}});',
    'function f():string{return "old";}const descriptor=foreignRead({run:0},"run");descriptor.probe;const n:number=f();String(n);', (realm) => {
      const foreign = new ManagedRealm();
      const read = foreign.Intrinsics['%Object%'].properties.get(Value('getOwnPropertyDescriptor'))!.Value!;
      realm.GlobalObject.properties.set(Value('foreignRead'), Descriptor({ Value: read, Writable: Value.true, Configurable: Value.true }));
      realm.GlobalObject.properties.set(Value('foreignPrototype'), Descriptor({ Value: foreign.Intrinsics['%Object.prototype%'], Writable: Value.true, Configurable: Value.true }));
    })).toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object.getOwnPropertyDescriptor("ab","0")','Object.getOwnPropertyDescriptors("ab")[0]'])('%s has no user-defined observation effect', (read) => {
  expect(observe('',`function f():string{return "old";}const descriptor=${read};const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('Reflect validates its target before coercing the property key', () => {
  expect(observe('let calls=0;const key={toString(){calls++;return "run";}};',
    'let caught=false;try{Reflect.getOwnPropertyDescriptor(1,key);}catch(e){caught=e instanceof TypeError;}String(caught)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:0' });
});

test('an extracted getter result still crosses its receiving boundary', () => {
  expect(observe('const target={get run(){return "bad";}};',
    'const descriptor=Object.getOwnPropertyDescriptor(target,"run");const n:number=descriptor.get();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test.each(['const [...target]=[globalThis];','function collect(...items){return items;}const target=collect(globalThis);'])('reflected array rest data retains its capability (%s)', (allocation) => {
  expect(observe('',`function f():string{return "old";}${allocation}const descriptor=Object.getOwnPropertyDescriptor(target,"0");descriptor.value.f=()=>1;const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a known ordinary alternative does not erase an unknown target', () => {
  expect(observe('const flag=false;const proxy=new Proxy({},{getOwnPropertyDescriptor(){globalThis.f=()=>1;return undefined;}});',
    'function f():string{return "old";}const target=flag?{}:(proxy||{});Object.getOwnPropertyDescriptor(target,"run");const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

const typedReads = ['Object.getOwnPropertyDescriptor(target,"x")', 'Reflect.getOwnPropertyDescriptor(target,"x")', 'Object.getOwnPropertyDescriptors(target).x'];

test.each(typedReads)('%s returns the declared Type Object', (read) => {
  expect(observe('const T=type uint8;const target={(x:uint8):1};',
    'const descriptor=' + read + ';String(descriptor.type===T)+":"+String(descriptor.value);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:1' });
});

test.each(['Object.defineProperty(target,"x",{type:"uint8",value:1,writable:true});', 'Reflect.defineProperty(target,"x",{type:type uint8,value:1,writable:true});'])('descriptor metadata survives reflective definition (%s)', (definition) => {
  expect(observe('', 'const target={};' + definition + 'const descriptor=Object.getOwnPropertyDescriptor(target,"x");String(descriptor.type===(type uint8));'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true' });
});

test('a reflected typed descriptor round trip preserves receiving enforcement', () => {
  expect(observe('const target={(x:uint8):1};',
    'const copy={};Object.defineProperty(copy,"x",Object.getOwnPropertyDescriptor(target,"x"));let caught=false;try{Reflect.set(copy,"x","bad");}catch(e){caught=e instanceof TypeError;}String(caught)+":"+String(copy.x);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:1' });
});

test('bulk reflected typed descriptors preserve receiving enforcement', () => {
  expect(observe('const target={(x:uint8):1};',
    'const copy=Object.create(null,Object.getOwnPropertyDescriptors(target));let caught=false;try{Reflect.defineProperty(copy,"x",{value:"bad"});}catch(e){caught=e instanceof TypeError;}String(caught)+":"+String(copy.x);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:1' });
});

test('editing descriptor type metadata does not alter the source storage type', () => {
  expect(observe('const target={(x:uint8):1};',
    'const descriptor=Reflect.getOwnPropertyDescriptor(target,"x");descriptor.type=type string;let caught=false;try{Reflect.set(target,"x","bad");}catch(e){caught=e instanceof TypeError;}String(caught)+":"+String(Object.getOwnPropertyDescriptor(target,"x").type===(type uint8));'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:true' });
});

test('an untyped property does not acquire type metadata from its current value', () => {
  expect(observe('const target={};Object.defineProperty(target,"x",{value:(1 := uint8),writable:true});',
    'const descriptor=Object.getOwnPropertyDescriptor(target,"x");String(Object.prototype.hasOwnProperty.call(descriptor,"type"));'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'false' });
});

test('a typed global var exposes its declared type rather than its current value type', () => {
  expect(observe('var typedGlobal:number=1;',
    'String(Reflect.getOwnPropertyDescriptor(globalThis,"typedGlobal").type===(type number));'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true' });
});

test('an inherited typed property has no own descriptor', () => {
  expect(observe('const target=Object.create({(x:uint8):1});',
    'String(Object.getOwnPropertyDescriptor(target,"x")===undefined);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true' });
});

test('a proxy descriptor preserves its returned Type Object and converts it once', () => {
  expect(observe('let calls=0;const T=type uint8;const target=new Proxy({},{getOwnPropertyDescriptor(){return {get type(){calls++;return T;},value:1,writable:true,configurable:true};}});',
    'const descriptor=Reflect.getOwnPropertyDescriptor(target,"x");String(descriptor.type===T)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:1' });
});

test('ordinary typed descriptor observation does not invoke the stored value getters', () => {
  expect(observe('let calls=0;const target={(x:any):{get run(){calls++;return 1;}}};',
    'const descriptor=Object.getOwnPropertyDescriptor(target,"x");String(descriptor.type===(type any))+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:0' });
});

test('a typed Symbol property retains its descriptor type', () => {
  expect(observe('const key=Symbol("x");const target={};Object.defineProperty(target,key,{type:type uint8,value:1});',
    'String(Object.getOwnPropertyDescriptor(target,key).type===(type uint8));'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true' });
});

test('a typed class field exposes its declared storage type', () => {
  expect(observe('class C{x:uint8=1;}const target=new C();',
    'String(Object.getOwnPropertyDescriptor(target,"x").type===(type uint8));'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true' });
});

test.each(typedReads)('%s retains metadata after a value-only redefinition', (read) => {
  expect(observe('const target={};Object.defineProperty(target,"x",{type:type uint8,value:1,writable:true});Object.defineProperty(target,"x",{value:2});',
    'const descriptor=' + read + ';String(descriptor.type===(type uint8))+":"+String(descriptor.value);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:2' });
});

test('bulk reflection includes non-enumerable descriptors without invoking accessors', () => {
  expect(observe('let calls=0;const target={};Object.defineProperty(target,"run",{get(){calls++;return 0;},enumerable:false});',
    'const descriptors=Object.getOwnPropertyDescriptors(target);String(typeof descriptors.run.get)+":"+String(descriptors.run.enumerable)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'function:false:0' });
});

test('bulk reflection includes Symbol descriptors without invoking accessors', () => {
  expect(observe('let calls=0;const key=Symbol("run");const target={get [key](){calls++;return 0;}};',
    'const descriptors=Object.getOwnPropertyDescriptors(target);String(typeof descriptors[key].get)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'function:0' });
});

test('a Symbol accessor observation preserves an intermediate capture', () => {
  expect(observe('const key=Symbol("run");const target={get [key](){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}const descriptor=Object.getOwnPropertyDescriptors(target)[key];const before=f;descriptor.get();const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('argument-side namespace replacement does not retarget a captured descriptor operation', () => {
  expect(observe('const replacement=()=>{globalThis.f=()=>1;return {};};const target={get run(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}Object.getOwnPropertyDescriptor(target,(Object.getOwnPropertyDescriptor=replacement,"run"));const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a later descriptor call uses the replaced reflection method', () => {
  expect(observe('const replacement=()=>{globalThis.f=()=>1;return {};};const target={};',
    'function f():string{return "old";}Object.getOwnPropertyDescriptor(target,(Object.getOwnPropertyDescriptor=replacement,"run"));Object.getOwnPropertyDescriptor(target,"run");const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a throwing proxy descriptor trap runs once and is not replayed', () => {
  expect(observe('let calls=0;const target=new Proxy({run:0},{getOwnPropertyDescriptor(){calls++;throw new Error("stop");}});',
    'let caught=false;try{Object.getOwnPropertyDescriptors(target);}catch(e){caught=e instanceof Error;}String(caught)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true:1' });
});

test('a reflected nominal property type preserves declaration identity', () => {
  expect(observe('class C{};const target={(x:C):new C()};',
    'String(Object.getOwnPropertyDescriptor(target,"x").type===C);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true' });
});

test('cross-realm observation preserves the stored Type Object identity', () => {
  expect(observe('', 'String(Object.getOwnPropertyDescriptor(foreignTarget,"x").type===foreignType);', (realm) => {
    const foreign = new ManagedRealm();
    const target = EnsureCompletion(foreign.evaluateScriptSkipDebugger('globalThis.T=type uint8;globalThis.target={(x:uint8):1};'));
    expect(target.Type).toBe('normal');
    realm.GlobalObject.properties.set(Value('foreignTarget'), Descriptor({ Value: foreign.GlobalObject.properties.get(Value('target'))!.Value!, Writable: Value.true, Configurable: Value.true }));
    realm.GlobalObject.properties.set(Value('foreignType'), Descriptor({ Value: foreign.GlobalObject.properties.get(Value('T'))!.Value!, Writable: Value.true, Configurable: Value.true }));
  })).toMatchObject({ completion: 'normal', bodyEntered: true, value: 'true' });
});
