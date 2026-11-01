import { expect, test } from 'vitest';
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

const routes: [string, string, string][] = [
  ['installed getter', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter});box.x;'],
  ['installed setter', 'const box={x:0};const setter=v=>{globalThis.f=()=>1;};', 'Object.defineProperty(box,"x",{set:setter});box.x=0;'],
  ['Reflect installed getter', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Reflect.defineProperty(box,"x",{get:getter});box.x;'],
  ['descriptor map getter', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperties(box,{x:{get:getter}});box.x;'],
  ['installed rest getter', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter,enumerable:true});const {...rest}=box;'],
  ['installed spread getter', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter,enumerable:true});const copy={...box};'],
  ['assign target setter', 'const box={x:0};const setter=v=>{globalThis.f=()=>1;};', 'Object.defineProperty(box,"x",{set:setter});Object.assign(box,{x:0});'],
  ['Reflect set receiver setter', 'const box={x:0};const setter=v=>{globalThis.f=()=>1;};', 'Object.defineProperty(box,"x",{set:setter});Reflect.set(box,"x",0);'],
  ...['enumerable', 'configurable', 'writable', 'get', 'set'].map((key): [string, string, string] => [
    `descriptor ${key} getter`, `const descriptor={get ${key}(){globalThis.f=()=>1;return undefined;}};`, 'Object.defineProperty({},"x",descriptor);'
  ]),
  ['prototype getter', 'const proto={get x(){globalThis.f=()=>1;return 0;}};', 'const box={};Object.setPrototypeOf(box,proto);box.x;'],
  ['prototype setter', 'const proto={set x(v){globalThis.f=()=>1;}};', 'const box={};Object.setPrototypeOf(box,proto);box.x=0;'],
  ['Object.create getter', 'const proto={get x(){globalThis.f=()=>1;return 0;}};', 'const box=Object.create(proto);box.x;'],
  ['Object.create stored global', 'const proto={world:globalThis};', 'const box=Object.create(proto);box.world.f=()=>1;'],
];

test.each(routes)('%s withdraws stale result evidence', (_name, setup, operation) => {
  expect(observe(setup, `function f():string{return "old";}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['installing a getter does not call it', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter});'],
  ['reading a different property does not call it', 'const box={x:0,y:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter});box.y;'],
  ['getter installation follows an earlier capture', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'const before=f;Object.defineProperty(box,"x",{get:getter});box.x;const n:number=before();'],
  ['own data descriptor remains precise', 'const box={x:0};', 'Object.defineProperty(box,"x",{value:1});box.x;'],
  ['earlier ordinary descriptor remains precise', 'const box={x:0};const descriptor={value:1};', 'Object.defineProperty(box,"x",descriptor);box.x;'],
])('%s preserves independent evidence', (_name, setup, operation) => {
  expect(observe(setup, `function f():string{return "old";}${operation}const n2:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});


test.each(['enumerable', 'configurable', 'writable'])('an own value does not hide the descriptor %s getter', (key) => {
  expect(observe(`const descriptor={value:0,get ${key}(){globalThis.f=()=>1;return true;}};`,
    'function f():string{return "old";}Object.defineProperty({},"x",descriptor);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['compound write', 'box.x+=1;'],
  ['update write', 'box.x++;'],
  ['logical write', 'box.x||=1;'],
  ['assignment pattern write', '({x:box.x}={x:1});'],
])('%s includes the installed setter', (_name, operation) => {
  expect(observe('const box={x:0};const setter=v=>{globalThis.f=()=>1;};',
    `function f():string{return "old";}Object.defineProperty(box,"x",{set:setter});${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['call', 'Object.defineProperty.call(null,box,"x",{get:getter});box.x;'],
  ['apply', 'Object.defineProperty.apply(null,[box,"x",{get:getter}]);box.x;'],
  ['bound', 'const install=Object.defineProperty.bind(null,box,"x");install({get:getter});box.x;'],
  ['return alias', 'const copy=Object.defineProperty(box,"x",{get:getter});copy.x;'],
  ['map return alias', 'const copy=Object.defineProperties(box,{x:{get:getter}});copy.x;'],
  ['getter result capability', 'Object.defineProperty(box,"x",{get:getter});box.x.f=()=>1;'],
])('%s retains the descriptor and target flow', (_name, operation) => {
  expect(observe('const box={x:0};const getter=()=>{globalThis.f=()=>1;return globalThis;};',
    `function f():string{return "old";}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['earlier access', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'box.x;Object.defineProperty(box,"x",{get:getter});'],
  ['write-only getter target', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter});try{box.x=1;}catch(e){}'],
  ['parenthesized getter target', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter});try{(box.x)=1;}catch(e){}'],
  ['pattern getter target', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter});try{({x:box.x}={x:1});}catch(e){}'],
  ['setter-only read', 'const box={x:0};const setter=v=>{globalThis.f=()=>1;};', 'Object.defineProperty(box,"x",{set:setter});box.x;'],
  ['unrelated assign target key', 'const box={x:0,y:0};const setter=v=>{globalThis.f=()=>1;};', 'Object.defineProperty(box,"x",{set:setter});Object.assign(box,{y:1});'],
  ['non-enumerable rest accessor', 'const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};', 'Object.defineProperty(box,"x",{get:getter,enumerable:false});const {...rest}=box;'],
  ['earlier accessor descriptor installation', 'const box={x:0};const descriptor={get(){globalThis.f=()=>1;return 0;}};', 'Object.defineProperty(box,"x",descriptor);'],
])('%s does not invent an accessor invocation', (_name, setup, operation) => {
  expect(observe(setup, `function f():string{return "old";}${operation}const n:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a later enumerability change permits a rest getter', () => {
  expect(observe('const box={x:0};const getter=()=>{globalThis.f=()=>1;return 0;};',
    'function f():string{return "old";}Object.defineProperty(box,"x",{get:getter,enumerable:false});Object.defineProperty(box,"x",{enumerable:true});const {...rest}=box;const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('descriptor conversion and the installed getter execute once in order', () => {
  expect(observe('let log="";const box={x:0};const descriptor={get enumerable(){log+="enum,";return true;},get configurable(){log+="config,";return true;},get get(){log+="get,";return function(){log+="read,";globalThis.f=()=>1;return 0;};},get set(){log+="set,";return undefined;}};',
    'function f():string{return "old";}Object.defineProperty(box,"x",descriptor);log+="installed,";box.x;const n:number=f();log+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'enum,config,get,set,installed,read,1' });
});

test('an abrupt descriptor getter is not replayed or swallowed', () => {
  expect(observe('let reads=0;const descriptor={value:0,get enumerable(){reads++;globalThis.f=()=>1;throw "stop";}};',
    'function f():string{return "old";}let caught="";try{Object.defineProperty({},"x",descriptor);}catch(e){caught=e;}const n:number=f();caught+":"+String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'stop:1:1' });
});

test('an installed getter still meets the runtime receiving check', () => {
  expect(observe('const box={x:0};const getter=()=>{globalThis.f=()=>"bad";return 0;};',
    'function f():number{return 1;}Object.defineProperty(box,"x",{get:getter});box.x;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('Reflect.set supplies its explicit receiver to a source setter', () => {
  expect(observe('const box={x:0};',
    'function f():string{return "old";}Object.defineProperty(box,"x",{set(v){this.f=()=>1;}});Reflect.set(box,"x",0,globalThis);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('unknown descriptors remain effectful in an unused body', () => {
  expect(observe('', 'function f():string{return "old";}function unused(d:any){Object.defineProperty({},"x",d);const n:number=f();} "ok";'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});

test('descriptor field lookup includes a newly installed inherited getter', () => {
  expect(observe('const proto={enumerable:0};const descriptor=Object.create(proto);descriptor.value=0;const getter=()=>{globalThis.f=()=>1;return true;};',
    'function f():string{return "old";}Object.defineProperty(proto,"enumerable",{get:getter});Object.defineProperty({},"x",descriptor);const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['"\\u{1F600}"', 'text'])('string source %s still writes UTF-16 index properties', (source) => {
  expect(observe('const text="\\u{1F600}";const box={1:0};const setter=v=>{globalThis.f=()=>1;};',
    `function f():string{return "old";}Object.defineProperty(box,"1",{set:setter});Object.assign(box,${source});const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an empty string copy does not invoke a target setter', () => {
  expect(observe('const box={0:0};const setter=v=>{globalThis.f=()=>1;};',
    'function f():string{return "old";}Object.defineProperty(box,"0",{set:setter});Object.assign(box,"");const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});
