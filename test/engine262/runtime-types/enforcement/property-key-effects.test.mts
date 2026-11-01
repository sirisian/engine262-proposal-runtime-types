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

const keySetup = 'const key={[Symbol.toPrimitive](){globalThis.f=()=>1;return "x";}};';

const routes = [
  ['Object.defineProperty', 'const box={};Object.defineProperty(box,key,{value:0});'],
  ['Reflect.defineProperty', 'const box={};Reflect.defineProperty(box,key,{value:0});'],
  ['Reflect.set', 'const box={};Reflect.set(box,key,0);'],
  ['Reflect.deleteProperty', 'const box={x:0};Reflect.deleteProperty(box,key);'],
  ['reflection call', 'Object.defineProperty.call(null,{},key,{value:0});'],
  ['reflection apply', 'Object.defineProperty.apply(null,[{},key,{value:0}]);'],
  ['bound reflection', 'const define=Object.defineProperty.bind(null,{},key);define({value:0});'],
  ['computed read', 'const box={x:0};box[key];'],
  ['computed write', 'const box={};box[key]=0;'],
  ['computed delete', 'const box={x:0};delete box[key];'],
  ['computed update', 'const box={x:0};box[key]++;'],
  ['object property name', 'const box={[key]:0};'],
  ['object method name', 'const box={[key](){}};'],
  ['class method name', 'class C{[key](){}}'],
  ['class field name', 'class C{[key]=0;}'],
  ['binding property name', 'const {[key]:x}={x:0};'],
  ['assignment property name', 'let x;({[key]:x}={x:0});'],
  ['optional computed read', 'const box={x:0};box?.[key];'],
];

test.each(routes)('%s includes property-key coercion', (_name, operation) => {
  expect(observe(keySetup, `function f():string{return "old";}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test.each([
  ['literal key', '', 'const box={x:0};box["x"];'],
  ['constant key alias', '', 'const key="x";const box={x:0};box[key];'],
  ['constant Boolean alias', '', 'const key=true;const box={};box[key];'],
  ['earlier primitive key', 'const key="x";', 'const box={x:0};box[key];'],
  ['null key', '', 'const box={};box[null];'],
  ['String key', '', 'const box={};box[String("x")];'],
  ['Symbol key', '', 'const box={};box[Symbol("x")];'],
  ['unused object key', keySetup, 'const box={x:0};box.x;'],
  ['captured callable', keySetup, 'const before=f;Object.defineProperty({},key,{value:0});const n:number=before();'],
  ['null optional base', keySetup, 'null?.[key];'],
  ['callee argument before key conversion', keySetup, 'function take(n:number){return 0;}Object.defineProperty({},key,{value:take(f())});'],
  ['pattern initializer before key conversion', keySetup, 'function take(n:number){return {};}const {[key]:x}=take(f());'],
])('%s preserves independent evidence', (_name, setup, operation) => {
  expect(observe(setup, `function f():string{return "old";}${operation}const n2:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a computed name precedes its property value', () => {
  expect(observe(keySetup, 'function f():string{return "old";}const box={[key]:f()};const n:number=box.x;String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('an unknown parameter key remains effectful in an unused body', () => {
  expect(observe('', 'function f():string{return "old";}function unused(key:any){const box={};box[key];const n:number=f();} "ok";'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});

test('a primitive branch does not hide an unknown key branch', () => {
  expect(observe('', 'function f():string{return "old";}function unused(value:any,choose:boolean){const key=choose?"x":value;const box={};box[key];const n:number=f();} "ok";'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});
test.each([
  ['well-known symbol', 'class C{[Symbol.iterator](){}}'],
  ['earlier call before a class method name', 'const n:number=f();class C{[key](){}}'],
  ['earlier call before an instance field name', 'const n:number=f();class C{[key]=0;}'],
  ['primitive apply key', 'Object.defineProperty.apply(null,[{},"x",{value:0}]);'],
])('%s does not erase earlier or primitive evidence', (_name, operation) => {
  expect(observe(keySetup, `function f():string{return "old";}${operation}const n2:number=f();`))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('the in operator includes key coercion', () => {
  expect(observe(keySetup, 'function f():string{return "old";}key in {};const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('simple assignment evaluates its RHS before converting the reference key', () => {
  expect(observe(keySetup, 'function f():string{return "old";}const box={};function take(n:number){return n;}box[key]=take(f());String(box.x);'))
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError' });
});

test('a computed pattern key precedes its default', () => {
  expect(observe(keySetup, 'function f():string{return "old";}const {[key]:x:number=f()}={};String(x);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a simple store converts its key once, after the RHS', () => {
  expect(observe('let log="";const key={get [Symbol.toPrimitive](){log+="lookup,";return function(hint){log+=hint+",";globalThis.f=()=>1;return "x";};}};',
    'function f():string{return "old";}const box={};box[key]=(log+="rhs,",f());const n:number=f();log+box.x+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'rhs,lookup,string,old:1' });
});

test('ordinary string-hint conversion preserves fallback order', () => {
  expect(observe('let log="";const key={toString(){log+="string,";return {};},valueOf(){log+="value,";globalThis.f=()=>1;return "x";}};',
    'function f():string{return "old";}Object.defineProperty({},key,{value:0});const n:number=f();log+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'string,value,1' });
});

test('a throwing store-key coercion preserves the already evaluated RHS', () => {
  expect(observe('let reads=0,rhs=0;const key={[Symbol.toPrimitive](){reads++;globalThis.f=()=>1;throw "stop";}};',
    'function f():string{return "old";}let caught="";const box={};try{box[key]=(rhs++,0);}catch(e){caught=e;}const n:number=f();caught+":"+String(reads)+":"+String(rhs)+":"+String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: 'stop:1:1:1' });
});

test.each([
  ['key expression', 'box[(change(),"x")]=take(f());'],
  ['nested base read', 'box[key].x=take(f());'],
  ['compound read', 'box[key]+=take(f());'],
  ['logical read', 'box[key]&&=take(f());'],
])('%s effects precede the assignment RHS', (_name, operation) => {
  expect(observe('const key={[Symbol.toPrimitive](){globalThis.f=()=>1;return "x";}};function change(){globalThis.f=()=>1;}',
    `function f():string{return "old";}const box={x:{x:0}};function take(n:number){return n;}${operation}const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a wrong result after coercion still fails at the receiving boundary', () => {
  expect(observe('const key={[Symbol.toPrimitive](){globalThis.f=()=>"bad";return "x";}};',
    'function f():number{return 1;}Object.defineProperty({},key,{value:0});const n:number=f();'))
    .toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test.each([
  ['direct replacement', 'Symbol=()=>key;'],
  ['global property replacement', 'globalThis.Symbol=()=>key;'],
  ['reflective replacement', 'Object.defineProperty(globalThis,"Symbol",{value:()=>key});'],
])('%s does not establish a primitive Symbol result', (_name, replace) => {
  expect(observe(keySetup,
    `function f():string{return "old";}${replace}const k:any=Symbol("key");const box={[k]:0};const n:number=f();String(n);`))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});

test('a prior-source replacement does not establish a primitive Symbol result', () => {
  expect(observe(`${keySetup}Symbol=()=>key;`,
    'function f():string{return "old";}const k:any=Symbol("key");const box={[k]:0};const n:number=f();String(n);'))
    .toMatchObject({ completion: 'normal', bodyEntered: true, value: '1' });
});
