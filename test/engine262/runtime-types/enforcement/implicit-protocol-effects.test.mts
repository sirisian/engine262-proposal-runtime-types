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
  [
    "object rest getter",
    "const box={get run(){globalThis.f=()=>1;return 0;}};",
    "const {...rest}=box;"
  ],
  [
    "assignment object rest getter",
    "const box={get run(){globalThis.f=()=>1;return 0;}};",
    "let rest;({...rest}=box);"
  ],
  [
    "object rest stored global",
    "const box={world:globalThis};",
    "const {...rest}=box;rest.world.f=()=>1;"
  ],
  [
    "assignment object rest stored global",
    "const box={world:globalThis};",
    "let rest;({...rest}=box);rest.world.f=()=>1;"
  ],
  [
    "array rest stored global",
    "const box=[globalThis];",
    "const [...rest]=box;rest[0].f=()=>1;"
  ],
  [
    "assignment array rest stored global",
    "const box=[globalThis];",
    "let rest;[...rest]=box;rest[0].f=()=>1;"
  ],
  [
    "empty pattern iterator getter",
    "const box={get [Symbol.iterator](){globalThis.f=()=>1;return function(){return {next(){return {done:true}}}};}};",
    "const []=box;"
  ],
  [
    "empty pattern iterator close",
    "const box={[Symbol.iterator](){return {next(){return {done:false,value:0}},return(){globalThis.f=()=>1;return {}}}}};",
    "const []=box;"
  ],
  [
    "iterator next getter",
    "const box={[Symbol.iterator](){return {get next(){globalThis.f=()=>1;return ()=>({done:true})}}}};",
    "const []=box;"
  ],
  [
    "iterator next call",
    "const box={[Symbol.iterator](){return {next(){globalThis.f=()=>1;return {done:true}}}}};",
    "const [x]=box;"
  ],
  [
    "iterator done getter",
    "const box={[Symbol.iterator](){return {next(){return {get done(){globalThis.f=()=>1;return true}}}}}};",
    "const [x]=box;"
  ],
  [
    "iterator value getter",
    "const box={[Symbol.iterator](){return {next(){return {done:false,get value(){globalThis.f=()=>1;return 0}}},return(){return {}}}}};",
    "const [x]=box;"
  ],
  [
    "elision advances iterator",
    "const box={[Symbol.iterator](){return {next(){globalThis.f=()=>1;return {done:true}}}}};",
    "const [,]=box;"
  ],
  [
    "call spread iterator",
    "const box={[Symbol.iterator](){globalThis.f=()=>1;return {next(){return {done:true}}}}};",
    "function ignore(){}ignore(...box);"
  ],
  [
    "constructor spread iterator",
    "const box={[Symbol.iterator](){globalThis.f=()=>1;return {next(){return {done:true}}}}};",
    "class C{}new C(...box);"
  ],
  [
    "for-of iterator",
    "const box={[Symbol.iterator](){globalThis.f=()=>1;return {next(){return {done:true}}}}};",
    "for(const x of box){}"
  ],
  [
    "for-of close on break",
    "const box={[Symbol.iterator](){return {next(){return {done:false,value:0}},return(){globalThis.f=()=>1;return {}}}}};",
    "for(const x of box){break;}"
  ],
  [
    "rest parameter forwarding",
    "const box={world:globalThis};",
    "function save(...args){return args;}const args=save(box);args[0].world.f=()=>1;"
  ]
];

test.each(routes)('%s withdraws stale result evidence', (_name, setup, operation) => {
  expect(observe(setup, `function f():string{return "old";}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['rest copy is a fresh object', 'const box={world:globalThis};', 'const {...rest}=box;rest.f=()=>1;'],
  ['known data rest copy', 'const box={x:0};', 'const {...rest}=box;rest.x=1;'],
  ['empty object pattern does not enumerate', 'const box=new Proxy({},{ownKeys(){globalThis.f=()=>1;return []}});', 'const {}=box;'],
  ['earlier captured callable survives rest getter', 'const box={get run(){globalThis.f=()=>1;return 0;}};', 'const before=f;const {...rest}=box;const n:number=before();'],
])('%s preserves independent evidence', (_name, setup, operation) => {
  expect(observe(setup, `function f():string{return "old";}${operation}const n2:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each([
  ['excluded key', 'const box={world:globalThis,x:0};', 'const {world,...rest}=box;rest.world={};rest.world.f=()=>1;'],
  ['non-enumerable getter', 'const box={};Object.defineProperty(box,"run",{get(){globalThis.f=()=>1;}});', 'const {...rest}=box;'],
  ['inherited getter', 'const box=Object.create({get run(){globalThis.f=()=>1;return 0;}});', 'const {...rest}=box;'],
  ['dense array binding', '', 'const [x]=[0];'],
  ['dense array rest', '', 'const [...rest]=[0];'],
  ['empty intrinsic array pattern', '', 'const []=[];'],
  ['earlier pattern default', 'const box={x:undefined,get later(){globalThis.f=()=>1;return 0;}};', 'const {x:n:number=f(),...rest}=box;'],
])('%s does not introduce an affecting effect', (_name, setup, operation) => {
  expect(observe(setup, `function f():string{return "old";}${operation}const n2:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('rest lookup follows the RHS initializer callee capture', () => {
  expect(observe('const box={get run(){globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}function take(x:number){return box;}const {...rest}=take(f());'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('spread iterator effects do not replace an already captured callee', () => {
  expect(observe('const box={[Symbol.iterator](){globalThis.f=()=>1;return {next(){return {done:true}}}}};',
    'function f(...args):string{return "old";}const n:number=f(...box);'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('rest getter runs exactly once at execution', () => {
  expect(observe('let reads=0;const box={get run(){reads++;globalThis.f=()=>1;return 0;}};',
    'function f():string{return "old";}const {...rest}=box;const n:number=f();String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test('proxy rest enumeration and value access run once', () => {
  expect(observe('let keys=0,reads=0;const box=new Proxy({run:0},{ownKeys(t){keys++;globalThis.f=()=>1;return Reflect.ownKeys(t);},get(t,k){reads++;return t[k];}});',
    'function f():string{return "old";}const {...rest}=box;const n:number=f();String(keys)+":"+String(reads)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1:1' });
});

test('iterator acquisition and closing occur once, without a step for an empty pattern', () => {
  expect(observe('let log="";const box={get [Symbol.iterator](){log+="get,";return function(){log+="call,";return {get next(){log+="next-get,";return function(){log+="step,";return {done:false}};},get return(){log+="return-get,";return function(){log+="close,";globalThis.f=()=>1;return {};};}};};}};',
    'function f():string{return "old";}const []=box;const n:number=f();log+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'get,call,next-get,return-get,close,1' });
});

test('a receiving check still rejects the value produced after an iterator effect', () => {
  expect(observe('const box={[Symbol.iterator](){globalThis.f=()=>"bad";return {next(){return {done:true}}}}};',
    'function f():number{return 1;}const []=box;const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('a primitive thrown while closing is not replaced or replayed', () => {
  expect(observe('let closes=0;const box={[Symbol.iterator](){return {next(){return {done:false}},return(){closes++;globalThis.f=()=>1;throw "close";}}}};',
    'function f():string{return "old";}let error="";try{const []=box;}catch(e){error=e;}const n:number=f();error+":"+String(closes)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'close:1:1' });
});

test('a replaced array iterator prototype defeats the intrinsic shortcut', () => {
  expect(observe('const original=Array.prototype[Symbol.iterator];Array.prototype[Symbol.iterator]=function(){globalThis.f=()=>1;return original.call(this);};',
    'function f():string{return "old";}const [x]=[0];const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an inherited return hook on an intrinsic array iterator remains observable', () => {
  expect(observe('Object.getPrototypeOf([][Symbol.iterator]()).return=function(){globalThis.f=()=>1;return {};};',
    'function f():string{return "old";}const []=[];const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each(['const []=box;', '[]=box;'])('the first iterator method is retained: %s', (operation) => {
  expect(observe('let reads=0;const box={get [Symbol.iterator](){reads++;if(reads>1)throw "repeated";return ()=>({next(){return {done:true}}});}};',
    `${operation}String(reads);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a missing iterator getter and tuple conversion each run once', () => {
  expect(observe('', 'let reads=0,conversions=0;class C{get [Symbol.iterator](){reads++;return undefined;}operator [number](){conversions++;return [7];}}const [n]=new C();String(reads)+":"+String(conversions)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1:7' });
});

test.each(['throw "getter";', 'return 1;'])('an invalid iterator does not enter tuple conversion: %s', (body) => {
  expect(observe('', `let reads=0,conversions=0;class C{get [Symbol.iterator](){reads++;${body}}operator [number](){conversions++;return [7];}}let caught=false;try{const []=new C();}catch(e){caught=true;}String(reads)+":"+String(conversions)+":"+String(caught);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:0:true' });
});

test('an unused body still treats an unknown rest operand as effectful', () => {
  expect(observe('', 'function f():string{return "old";}function run(box:any){const {...rest}=box;const n:number=f();} "ok";'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});

test('literal primitive object rest has no user-code lookup', () => {
  expect(observe('', 'function f():string{return "old";}const {...rest}="abc";const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('an array hole can reach an inherited indexed getter', () => {
  expect(observe('Object.defineProperty(Array.prototype,"0",{configurable:true,get(){globalThis.f=()=>1;return 0;},set(v){}});',
    'function f():string{return "old";}const [x]=[,];const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('for-await includes possible protocol effects in an unused body', () => {
  expect(observe('', 'function f():string{return "old";}async function run(xs:any){for await(const x of xs){}const n:number=f();} "ok";'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});

test('delegated yield includes possible protocol effects in an unused body', () => {
  expect(observe('', 'function f():string{return "old";}function* run(xs:any){yield* xs;const n:number=f();} "ok";'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});
