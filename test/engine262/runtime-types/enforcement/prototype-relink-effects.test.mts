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

test.each(['Object','Reflect'])('%s ordinary relinking alone preserves independent evidence', (namespace) => {
  expect(observe('const target={};const proto={get unused(){globalThis.f=()=>1;return 0;}};',
    `function f():string{return "old";}${namespace}.setPrototypeOf(target,proto);const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['Object','Reflect'])('%s relinking affects the later inherited invocation', (namespace) => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}${namespace}.setPrototypeOf(target,proto);target.call(null,{},"x",{value:0});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object','Reflect'])('%s relinking does not invalidate a capture before the inherited call', (namespace) => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}${namespace}.setPrototypeOf(target,proto);const before=f;target.call(null,{},"x",{value:0});const n:number=before();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['Object','Reflect'])('%s relinking does not expose a shadowed inherited method', (namespace) => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;const proto={call(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}${namespace}.setPrototypeOf(target,proto);target.call(null,{},"x",{value:0});const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['Object','Reflect'])('%s replacement remains an ordinary effectful call', (namespace) => {
  expect(observe(`${namespace}.setPrototypeOf=function(){globalThis.f=()=>1;};`,
    `function f():string{return "old";}${namespace}.setPrototypeOf({},{});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['Object','Reflect'])('a saved original %s helper retains its summary', (namespace) => {
  expect(observe(`const link=${namespace}.setPrototypeOf;${namespace}.setPrototypeOf=function(){globalThis.f=()=>1;};`,
    'function f():string{return "old";}link({},{});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['Object','Reflect'])('%s invokes a target proxy trap once at relinking', (namespace) => {
  expect(observe('let hits=0;const target=new Proxy({},{setPrototypeOf(t,p){hits++;globalThis.f=()=>1;return Reflect.setPrototypeOf(t,p);}});',
    `function f():string{return "old";}${namespace}.setPrototypeOf(target,{});const n:number=f();String(hits)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each([
  ['borrowed', 'Object.setPrototypeOf.call(null,target,proto);'],
  ['applied', 'Reflect.setPrototypeOf.apply(null,[target,proto]);'],
  ['bound', 'const link=Object.setPrototypeOf.bind(null,target);link(proto);'],
  ['returned alias', 'const linked=Object.setPrototypeOf(target,proto);linked.call();'],
])('%s relinking retains its later inherited effects', (_name, operation) => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    `function f():string{return "old";}${operation}target.call(null,{},"x",{value:0});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a new bound function captures the target prototype after relinking', () => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}Object.setPrototypeOf(target,proto);const bound=Function.prototype.bind.call(target,null,{},"x");bound.call(null,{value:0});const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a bound function retains its captured prototype after later target relinking', () => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const bound=target.bind(null,{},"x");Object.setPrototypeOf(target,proto);bound.call(null,{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('argument-side relinking does not retarget a captured adapter', () => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}target.call(null,{},"x",(Object.setPrototypeOf(target,proto),{value:0}));const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('binding acquires its prototype after argument-side relinking', () => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const bound=target.bind((Object.setPrototypeOf(target,proto),null),{},"x");bound.call(null,{value:0});const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('deletion can expose a newly linked prototype', () => {
  expect(observe('const target=Object.defineProperty;target.call=Function.prototype.call;const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}Object.setPrototypeOf(target,proto);delete target.call;target.call(null,{},"x",{value:0});const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('relinking an intermediate prototype affects descendant lookup', () => {
  expect(observe('const target=Object.defineProperty;const middle={};Object.setPrototypeOf(middle,Function.prototype);Object.setPrototypeOf(target,middle);const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}Object.setPrototypeOf(middle,proto);target.call(null,{},"x",{value:0});const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('literal own methods hide newly linked inherited methods', () => {
  expect(observe('const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const target={call(){}};Object.setPrototypeOf(target,proto);target.call();const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('relinking a distinct allocation does not affect the original target', () => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}Object.setPrototypeOf({},proto);target.call(null,{},"x",{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an inherited getter runs once with the original receiver', () => {
  expect(observe('let reads=0;const target=Object.defineProperty;',
    'function f():string{return "old";}target.owner=globalThis;const proto={get call(){reads++;this.owner.f=()=>1;return ()=>0;}};Object.setPrototypeOf(target,proto);target.call();const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a throwing inherited getter skips arguments and is not replayed', () => {
  expect(observe('let gets=0,args=0;const target=Object.defineProperty;const proto={get call(){gets++;globalThis.f=()=>1;throw "stop";}};',
    'function f():string{return "old";}Object.setPrototypeOf(target,proto);let caught="";try{target.call((args++,null));}catch(e){caught=e;}const n:number=f();caught+":"+gets+":"+args+":"+n;'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'stop:1:0:1' });
});

test('an incompatible replacement result meets the receiving check', () => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>"bad";}};',
    'function f():number{return 1;}Object.setPrototypeOf(target,proto);target.call();const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test.each([
  ['inherited setter', 'const target={};const proto={set x(v){globalThis.f=()=>1;}};', 'target.x=0;'],
  ['proxy has', 'const target={};const proto=new Proxy({},{has(){globalThis.f=()=>1;return false;}});', '"x" in target;'],
  ['proxy enumeration', 'const target={};const proto=new Proxy({},{ownKeys(){globalThis.f=()=>1;return [];}});', 'for(const key in target){}'],
  ['numeric coercion', 'const target={};const proto={[Symbol.toPrimitive](){globalThis.f=()=>1;return 0;}};', '+target;'],
  ['template coercion', 'const target={};const proto={[Symbol.toPrimitive](){globalThis.f=()=>1;return 0;}};', '`${target}`;'],
  ['loose equality', 'const target={};const proto={[Symbol.toPrimitive](){globalThis.f=()=>1;return 0;}};', 'target==0;'],
  ['descriptor conversion', 'const target={value:0};const proto={get enumerable(){globalThis.f=()=>1;return false;}};', 'Object.defineProperty({},"x",target);'],
  ['apply list', 'const target={length:1};const proto={get 0(){globalThis.f=()=>1;return 0;}};', 'function consume(){}consume.apply(null,target);'],
])('%s retains effects at the consuming operation', (_name, setup, operation) => {
  expect(observe(setup, `function f():string{return "old";}Object.setPrototypeOf(target,proto);${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['typeof target;', '!!target;', 'target===0;'])('operation %s does not invent a prototype access', (operation) => {
  expect(observe('const target={};const proto={[Symbol.toPrimitive](){globalThis.f=()=>1;return 0;}};',
    `function f():string{return "old";}Object.setPrototypeOf(target,proto);${operation}const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('relinked source arrays lose the original iterator proof at iteration', () => {
  expect(observe('const proto={*[Symbol.iterator](){globalThis.f=()=>1;yield 0;}};',
    'function f():string{return "old";}const target=[0];Object.setPrototypeOf(target,proto);for(const x of target){}const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('using a proxy as the new prototype does not itself invoke its traps', () => {
  expect(observe('const target={};const proto=new Proxy({},{getPrototypeOf(){globalThis.f=()=>1;return null;}});',
    'function f():string{return "old";}Object.setPrototypeOf(target,proto);const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('possible abstract prototype cycles terminate without executing a cycle', () => {
  expect(observe('', 'const a={},b={};Object.setPrototypeOf(a,b);const ok=Reflect.setPrototypeOf(b,a);String(ok)+":"+typeof a.call;'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'false:undefined' });
});

test('a store observes relinking performed by its right-hand side', () => {
  expect(observe('const target={};const proto={set x(v){globalThis.f=()=>1;}};',
    'function f():string{return "old";}target.x=(Object.setPrototypeOf(target,proto),0);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('descriptor conversion observes argument-side relinking', () => {
  expect(observe('let reads=0;const target={value:0};const proto={get enumerable(){reads++;globalThis.f=()=>1;return false;}};',
    'function f():string{return "old";}Object.defineProperty({},"x",(Object.setPrototypeOf(target,proto),target));const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('instanceof observes a newly inherited hasInstance method', () => {
  expect(observe('const target=function(){};const proto={[Symbol.hasInstance](){globalThis.f=()=>1;return false;}};',
    'function f():string{return "old";}Object.setPrototypeOf(target,proto);({}) instanceof target;const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a source callback retains the relinked receiver flow', () => {
  expect(observe('const target=Object.defineProperty;const proto={call(){globalThis.f=()=>1;}};',
    'function f():string{return "old";}function consume(value){value.call(null,{},"x",{value:0});}Object.setPrototypeOf(target,proto);consume(target);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});


test.each(['Object', 'Reflect'])('%s does not treat a decorated function as a proven ordinary target', (namespace) => {
  expect(observe('let hits=0;const replacement=new Proxy(function(){},{setPrototypeOf(t,p){hits++;globalThis.f=()=>1;return Reflect.setPrototypeOf(t,p);}});function replace(){return replacement;}',
    `function f():string{return "old";}@replace function target(){}${namespace}.setPrototypeOf(target,{});const n:number=f();String(hits)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each(['Object', 'Reflect'])('%s requires ordinary-target evidence for every contributing expression', (namespace) => {
  expect(observe('let hits=0;const proxy=new Proxy({},{setPrototypeOf(t,p){hits++;globalThis.f=()=>1;return Reflect.setPrototypeOf(t,p);}});',
    `function f():string{return "old";}const target=false?{}:(proxy||{});${namespace}.setPrototypeOf(target,{});const n:number=f();String(hits)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('a primitive target of the original Object helper cannot invoke a relinking trap', () => {
  expect(observe('', 'function f():string{return "old";}const target=1;Object.setPrototypeOf(target,{});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});


test('right-hand-side deletion exposes an inherited setter after relinking', () => {
  expect(observe('const target={x:0};const proto={set x(v){globalThis.f=()=>1;}};',
    'function f():string{return "old";}Object.setPrototypeOf(target,proto);target.x=(delete target.x,0);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a fixed own array element still hides an inherited setter after relinking', () => {
  expect(observe('const proto={set 1(v){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const target=[0,0];Object.setPrototypeOf(target,proto);target[1]=0;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a post-spread array element is not a fixed own-index proof', () => {
  expect(observe('const proto={set 1(v){globalThis.f=()=>1;}};',
    'function f():string{return "old";}const target=[...[],0];Object.setPrototypeOf(target,proto);target[1]=0;const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});
