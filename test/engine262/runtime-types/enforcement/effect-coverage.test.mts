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

const routes = [
  ['array prototype conversion', 'class ArraySource{operator [].<number>(){mutate();Object.setPrototypeOf(Array.prototype,Object.prototype);return [1];}}Object.setPrototypeOf(Array.prototype,ArraySource.prototype);', 'const converted:[].<number>=[0];'],
  ['relinked source conversion', 'class Box{operator number(){mutate();return 1;}}const box={};', 'Object.setPrototypeOf(box,Box.prototype);const converted:number=box;'],
  ['relinked unary operator', 'class Box{operator !():boolean{mutate();return true;}}const box={};', 'Object.setPrototypeOf(box,Box.prototype);!box;'],
  ['declared unary operator', 'class Box{operator !():boolean{mutate();return true;}}const box:any=new Box();', '!box;'],
  ['declared mixed primitive operator', 'primitive uint8{operator *(rhs:string):string{mutate();return "x";}}', 'const q:uint8=3;q*"x";'],
  [
    "unary numeric coercion",
    "const box={valueOf(){return mutate();}};",
    "+box;"
  ],
  [
    "binary coercion",
    "const box={valueOf(){return mutate();}};",
    "box + 0;"
  ],
  [
    "template coercion",
    "const box={toString(){mutate();return \"x\";}};",
    "`${box}`;"
  ],
  [
    "loose equality coercion",
    "const box={valueOf(){return mutate();}};",
    "box == 1;"
  ],
  [
    "membership trap",
    "const box=new Proxy({},{has(){mutate();return true;}});",
    "\"x\" in box;"
  ],
  [
    "enumeration trap",
    "const box=new Proxy({},{ownKeys(){mutate();return [];}});",
    "for(const k in box){}"
  ],
  [
    "custom instance test",
    "const box={[Symbol.hasInstance](){mutate();return true;}};",
    "({}) instanceof box;"
  ],
  [
    "primitive getter",
    "Object.defineProperty(Number.prototype,\"run\",{get(){return mutate();}});",
    "(1).run;"
  ],
  [
    "tag call",
    "const tag=()=>mutate();",
    "tag`x`;"
  ],
  [
    "class decorator",
    "const decorate=()=>{mutate();};",
    "@decorate class A {}"
  ],
  [
    "field decorator",
    "const decorate=()=>{mutate();};",
    "class A {@decorate x:number;}"
  ],
  [
    "logical and callee",
    "const run=()=>mutate();",
    "(true && run)();"
  ],
  [
    "logical or callee",
    "const run=()=>mutate();",
    "(false || run)();"
  ],
  [
    "nullish callee",
    "let optional:any=null;const run=()=>mutate();",
    "(optional ?? run)();"
  ],
  [
    "native callback",
    "const run=()=>mutate();",
    "[1].map(run);"
  ],
  [
    "new constructor",
    "class Run {constructor(){mutate();}}",
    "new Run();"
  ],
  [
    "named argument callback",
    "const run=()=>mutate();function invoke(fn:any){fn();}",
    "invoke(fn:run);"
  ],
  ['primitive setter', 'Object.defineProperty(Number.prototype,"run",{set(v){mutate();}});', '(1).run=0;'],
  ['global getter', 'Object.defineProperty(globalThis,"trigger",{get(){return mutate();}});', 'trigger;'],
  ['global setter', 'Object.defineProperty(globalThis,"trigger",{set(v){mutate();}});', 'globalThis.trigger=0;'],
  ['compound coercion', 'let box={valueOf(){return mutate();}};', 'box+=0;'],
  ['template argument coercion', 'const box={toString(){mutate();return "x";}};', 'String(`${box}`);'],
  ['disposal', 'const box={[Symbol.dispose](){mutate();}};', '{using x=box;}'],
] as const;

for (const [name, setup, operation] of routes) {
  const initial = 'let calls=0;const mutate=()=>{calls++;globalThis.f=()=>1;return 1;};'+setup;
  test(`${name} withdraws a later global result assumption`, () => {
    expect(observe(initial, `function f():string{return "old";}${operation}const n:number=f();String(calls)+":"+String(n);`))
      .toMatchObject({completion:'normal',bodyEntered:true,value:'1:1'});
  });
  test(`${name} preserves a capture made before the operation`, () => {
    expect(observe(initial, `function f():string{return "old";}const before=f;${operation}const n:number=before();`))
      .toMatchObject({completion:'throw',bodyEntered:false,errorClass:'StaticTypeError'});
  });
  test(`${name} retains actual receiving admission`, () => {
    expect(observe(initial.replace('globalThis.f=()=>1','globalThis.f=()=>"bad"'), `function f():number{return 1;}${operation}const n:number=f();`))
      .toMatchObject({completion:'throw',bodyEntered:true,errorClass:'TypeError'});
  });
}

const deferredSetup = 'let calls=0;function opaque(){calls++;globalThis.f=()=>1;}';
test('an uncalled opaque body preserves a top-level contract', () => {
  expect(observe(deferredSetup, 'function f():string{return "old";}function unused(){opaque();}const before=f;const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});
test('an opaque body called after capture preserves the captured contract', () => {
  expect(observe(deferredSetup, 'function f():string{return "old";}function run(){opaque();}const before=f;run();const n:number=before();'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});
test('a nested opaque body is projected to its actual top-level call', () => {
  expect(observe(deferredSetup, 'function f():string{return "old";}function inner(){opaque();}function run(){inner();}run();const n:number=f();String(n)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});
test('an unknown callee alternative cannot hide behind a known callable', () => {
  expect(observe(deferredSetup + 'function choose(){return opaque;}',
    'function f():string{return "old";}function noop(){}const run=false?noop:choose();run();const n:number=f();String(n)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});
test('named argument reordering retains callback effects', () => {
  expect(observe(deferredSetup,
    'function f():string{return "old";}function run(a:any,b:any){b();}run(b:opaque,a:0);const n:number=f();String(n)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

for (const effect of ['globalThis.f=()=>1;', 'Object.defineProperty(globalThis,"f",{value:()=>1});',
  'Object.assign(globalThis,{f:()=>1});',
  'Object.defineProperties(globalThis,{f:{value:()=>1}});']) {
  test(`an uncalled keyed write preserves a captured contract: ${effect}`, () => {
    expect(observe('', `function f():string{return "old";}function unused(){${effect}}const before=f;const n:number=before();`))
      .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
  });
  test(`a called keyed write invalidates the later read: ${effect}`, () => {
    expect(observe('', `function f():string{return "old";}function run(){${effect}}run();const n:number=f();String(n);`))
      .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
  });
}

const conversionSetup = 'let calls=0;class S{operator uint8(){calls++;globalThis.f=()=>1;return 1;}}const raw:any=new S();';
for (const effect of [
  'let n:uint8=raw;',
  'let n:uint8;n=raw;',
  'let a:{x:uint8}={x:0};a.x=raw;',
  'let a:[uint8]=[0];a[0]=raw;',
  'const a={(x:uint8):raw};',
  'function take(x:uint8){}take(raw);',
  'function take():uint8{return raw;}take();',
  'const take=():uint8=>raw;take();',
]) {
  test(`implicit admission retains conversion effects: ${effect}`, () => {
    expect(observe(conversionSetup, `function f():string{return "old";}${effect}const result:number=f();String(result)+":"+String(calls);`))
      .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
  });
  test(`implicit admission preserves an earlier captured contract: ${effect}`, () => {
    expect(observe(conversionSetup, `function f():string{return "old";}const before=f;${effect}const result:number=before();`))
      .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
  });
}

test('a failed implicit member conversion runs once and preserves the previous store', () => {
  expect(observe('let calls=0;class S{operator uint8(){calls++;globalThis.f=()=>1;const bad:any=257;return bad;}}const raw:any=new S();',
    'function f():string{return "old";}let a:{x:uint8}={x:0};try{a.x=raw;}catch(e){if(!(e instanceof RangeError))throw e;}const result:number=f();String(a.x)+":"+String(result)+":"+String(calls);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '0:1:1' });
});

test('intrinsic primitive arithmetic retains an independently closed return contract', () => {
  expect(observe('', 'function f(x:uint8):uint8{return x+1;}function unused(){const n:uint16=f(1);}'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});


test.each([
  'globalThis.uint8=Target;',
  'const world=globalThis;world.uint8=Target;',
  'Object.defineProperty(globalThis,"uint8",{value:Target,configurable:true});',
])('a replaced builtin type name retains admission effects: %s', (replace) => {
  expect(observe('let calls=0;class Target{constructor(x:number){calls++;globalThis.f=()=>1;}}',
    `function f():string{return "old";}${replace}const x:uint8=1;const n:number=f();String(calls)+":"+String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});


test.each(['', 'run();'])('an activation capture precedes its later opaque operation: %s', (call) => {
  expect(observe(deferredSetup,
    `function f():string{return "old";}function run(){const n:number=f();opaque();}${call}`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test.each(['opaque();', 'helper();'])('an earlier operation in an uncalled activation retains effects: %s', (before) => {
  expect(observe(deferredSetup,
    `function f():string{return "old";}function helper(){opaque();}function unused(){${before}const n:number=f();}"ok";`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});

test.each(['run(opaque());', 'run.apply(null,args);'])('call preparation precedes reads inside the body: %s', (call) => {
  expect(observe(deferredSetup + 'const args={get length(){opaque();return 0;}};',
    `function f():string{return "old";}function run(){const n:number=f();return String(n)+":"+String(calls);}${call}`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1:1' });
});

test.each([
  'function run(){const n:number=f();opaque();}run();run();',
  'function run(){for(let i=0;i<2;i++){const n:number=f();opaque();}}run();',
  'function run(){const n:number=f();opaque();}for(let i=0;i<2;i++){run();}',
  'function run(){const n:number=f();opaque();}function outer(){for(let i=0;i<2;i++){run();}}outer();',
])('a previous activation or iteration can invalidate a later capture: %s', (body) => {
  expect(observe('function opaque(){globalThis.f=()=>"bad";}', `function f():number{return 1;}${body}`))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});
