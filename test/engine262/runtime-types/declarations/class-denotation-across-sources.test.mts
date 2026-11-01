import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, ClearKeptObjects, gc } from '#self';

function sequence(...sources: string[]) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  return sources.map((source) => {
    let bodyEntered = false;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === 'ScriptBody') bodyEntered = true;
    };
    try {
      const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
      return { completion: completion.Type, bodyEntered,
        value: completion.Type === 'normal' ? (completion.Value as { stringValue?: () => string })?.stringValue?.() : undefined,
        errorClass: completion.Type === 'throw' ? nativeErrorClass(completion.Value, realm) : undefined,
        diagnostic: TypeDiagnosticOf(completion.Value),
        message: (completion.Value as { HostDefinedMessageString?: string })?.HostDefinedMessageString };
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

test.each([
  ['later script', ['class V{}class W extends V{}', 'V=class {};', 'const v:V=new W();"ok";']],
  ['type operator and ordinary value diverge', ['class V{}const Original=V;', 'V=class {};', 'String(type V===Original)+"/"+String(V===Original);'], 'true/false'],
  ['non-class replacement', ['class V{}const Original=V;', 'V=0;', 'const v:V=new Original();String(type V===Original)+"/"+String(V);'], 'true/0'],
  ['direct eval', ['class V{}class W extends V{}', 'eval("V=class {}");', `eval('const v:V=new W();"ok";');`]],
  ['indirect eval', ['class V{}class W extends V{}', '(0,eval)("V=class {}");', `(0,eval)('const v:V=new W();"ok";');`]],
  ['dynamic function', ['class V{}class W extends V{}', 'Function("V=class {}")();', `Function('const v:V=new W();return "ok";')();`]],
  ['ordinary const shadow', ['class V{}', '{const V=type string;const v:V="ok";v;}']],
  ['class shadow', ['class V{}const Original=V;', '{class V{}const v:V=new V();String(type V===Original);}'], 'false'],
  ['generic declaration', ['class V<T:type>{}const Original=V;', 'V=class {};', 'const v:V.<string> = new Original.<string>();"ok";']],
  ['generic default', ['class V<T:type=string>{}const Original=V;', 'V=class {};', 'const v:V=new Original.<string>();"ok";']],
  ['builtin spelling', ['class Map{}const Original=Map;', 'Map=class {};', 'const v:Map=new Original();String(type Map===Original);'], 'true'],
  ['captured original heritage', ['class V{}class W extends V{}const Original=V;', 'V=class {};', 'String(Reflect.isAssignable(type W,type V));'], 'true'],
  ['type alias captures the declaration', ['class V{}const Original=V;', 'V=class {};', 'type Saved=V;', 'const v:Saved=new Original();"ok";']],
  ['inner class context', ['class V{static self(){return type V;}}const Original=V;', 'V=class {};', 'String(Original.self()===type V);'], 'true'],
  ['immutable expression keeps its established behavior', ['const V=class{};const Original=V;', 'const v:V=new Original();"ok";']],
  ['dynamic ordinary shadow', ['class V{}with({V:type string}){String(type V===type string);}'], 'true'],
  ['reflection reads the actual constructor argument', ['class V{}const Original=V;', 'V=class {};', 'String(Reflect.isAssignable(V,type V))+"/"+String(Reflect.isAssignable(Original,type V));'], 'false/true'],
  ['later heritage reads the current constructor', ['class V{}', 'V=class {};class W extends V{}', 'String(Reflect.isAssignable(type W,type V));'], 'false'],
  ['global property is a different binding', ['class V{}const Original=V;', 'globalThis.V=class {};', 'String(V===Original)+"/"+String(type V===Original);'], 'true/true'],
  ['reading a type does not replay static initialization', ['let count=0;class V{static{count++;}}const Original=V;', 'V=class {};', 'const t=type V;const u=type V;String(count)+"/"+String(t===u);'], '1/true'],
  ['generic type argument', ['class V{}const Original=V;function identity<T:type>(){return T;}', 'V=class {};', 'String(identity.<V>()===Original);'], 'true'],
])('%s keeps the declaration denotation', (_name, sources, expected?: string) => {
  const results = sequence(...sources as string[]);
  for (const result of results) expect(result).toMatchObject({ completion: 'normal', errorClass: undefined });
  expect(results.at(-1)?.value).toBe(expected ?? 'ok');
});

test('a replacement constructor cannot satisfy the original receiving contract', () => {
  const results = sequence('class V{}', 'V=class {};', 'const v:V=new V();');
  expect(results[2]).toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test('known incompatible values are still rejected before body entry', () => {
  expect(sequence('class V{}', 'V=class {};', 'const v:V=1;')[2])
    .toMatchObject({ completion: 'throw', bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability' } });
});

test('a nearer uninitialized ordinary binding blocks the outer class', () => {
  const result = sequence('class V{}const Original=V;', '{const v:V=new Original();const V=type string;}')[1];
  expect(result).toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'ReferenceError', diagnostic: undefined });
  expect(result.message).toContain('cannot be used before initialization');
});

test('successful publication survives a later abrupt completion', () => {
  const results = sequence('class V{}const Original=V;throw new Error("after");', 'V=class {};', 'const v:V=new Original();String(type V===Original);');
  expect(results[0]).toMatchObject({ errorClass: 'Error', bodyEntered: true });
  expect(results[2]).toMatchObject({ completion: 'normal', value: 'true' });
});

test('failed class initialization publishes no completed outer denotation', () => {
  const results = sequence('class V{static{throw new Error("failed");}}', 'const t=type V;', 'V;');
  expect(results[0]).toMatchObject({ errorClass: 'Error', bodyEntered: true });
  expect(results[1]).toMatchObject({ completion: 'throw', errorClass: 'ReferenceError', bodyEntered: true, diagnostic: undefined });
  expect(results[1].message).toContain('cannot be used before initialization');
  expect(results[2]).toMatchObject({ completion: 'throw', errorClass: 'ReferenceError' });
});

test('escaped local activations retain separate declarations after rebinding', () => {
  const results = sequence(`
    function make(){class C{}const Original=C;C=class {};return {Original,accept:(x:any)=>{const c:C=x;return c;},denote:()=>type C};}
    const first=make(),second=make();
  `, 'String(first.denote()===first.Original)+"/"+String(first.denote()===second.denote());',
  'first.accept(new first.Original());"ok";', 'first.accept(new second.Original());');
  expect(results[1]).toMatchObject({ completion: 'normal', value: 'true/false' });
  expect(results[2]).toMatchObject({ completion: 'normal', value: 'ok' });
  expect(results[3]).toMatchObject({ completion: 'throw', bodyEntered: true, errorClass: 'TypeError' });
});

test.each(['named', 'namespace', 're-export'])('%s import denotes the producer declaration', async (route) => {
  const imports = route === 'named' ? 'import {V as C,Original} from "dep";'
    : route === 'namespace' ? 'import * as ns from "dep";'
      : 'import {C,Original} from "forward";';
  const target = route === 'namespace' ? 'ns.V' : 'C';
  const original = route === 'namespace' ? 'ns.Original' : 'Original';
  const result = await observeModuleGraph({
    dep: 'export class V{}export const Original=V;V=class {};',
    forward: 'export {V as C,Original} from "dep";',
    main: `${imports}const v:${target}=new ${original}();if(type ${target}!==${original})throw new Error("denotation");if(${target}===${original})throw new Error("value read");`,
  });
  expect(result).toMatchObject({ status: 'fulfilled', errorClass: undefined });
});

test.each(['named', 'namespace', 'nested namespace'])('%s generic import retains application and defaults', async (route) => {
  const imports = route === 'named' ? 'import {V as C,Original} from "dep";'
    : route === 'namespace' ? 'import * as ns from "dep";' : 'import * as root from "forward";';
  const target = route === 'named' ? 'C' : route === 'namespace' ? 'ns.V' : 'root.ns.V';
  const original = route === 'named' ? 'Original' : route === 'namespace' ? 'ns.Original' : 'root.ns.Original';
  expect(await observeModuleGraph({
    dep: 'export class V<T:type=string>{}export const Original=V;V=class {};',
    forward: 'export * as ns from "dep";',
    main: `${imports}const a:${target}=new ${original}.<string>();const b:${target}.<number> = new ${original}.<number>();if(!Reflect.isAssignable(type ${target}.<number>,${original}.<number>)||Reflect.isAssignable(type ${target}.<number>,${original}.<string>))throw new Error("specialization");`,
  })).toMatchObject({ status: 'fulfilled', errorClass: undefined });
});

test.each(['named', 'anonymous'])('%s default class export retains its declaration', async (form) => {
  expect(await observeModuleGraph({
    dep: form === 'named' ? 'export default class V{}export const Original=V;V=class {};'
      : 'export default class {m(){return "ok";}}',
    main: form === 'named' ? 'import C,{Original} from "dep";const c:C=new Original();if(type C!==Original)throw new Error("default");'
      : 'import C from "dep";const c:C=new C();if(c.m()!=="ok")throw new Error("default");',
  })).toMatchObject({ status: 'fulfilled', errorClass: undefined });
});

test('a later script cannot revive a failed binding through an outer same-named class', () => {
  const results = sequence('class V{}const Original=V;', 'function f(){const v:V=new Original();let V;}f();');
  expect(results[1]).toMatchObject({ completion: 'throw', errorClass: 'StaticTypeError', bodyEntered: false });
});

test('module suspension preserves the producer denotation and live value', async () => {
  expect(await observeModuleGraph({
    dep: 'export class V{}export const Original=V;await 0;V=class {};',
    main: 'import {V,Original} from "dep";await 0;const v:V=new Original();if(type V!==Original||V===Original)throw new Error("await");',
  })).toMatchObject({ status: 'fulfilled', errorClass: undefined });
});

test('a retained declaration keeps its original constructor reachable', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('class V{}const weak=new WeakRef(V);V=class {};')).Type).toBe('normal');
  ClearKeptObjects();
  gc();
  const result = EnsureCompletion(realm.evaluateScriptSkipDebugger('String(weak.deref()===type V);'));
  expect(result.Type).toBe('normal');
  expect((result.Value as { stringValue(): string }).stringValue()).toBe('true');
});

test('a failed declaration cannot complete an escaped receiving dependency', () => {
  const results = sequence(`
    let take,raw;
    try {
      take=(x:any)=>{const c:C=x;return c;};
      class C{static{raw=Object.create(this.prototype);throw new Error("failed");}}
    } catch(e) {}
  `, 'take(raw);');
  expect(results[0]).toMatchObject({ completion: 'normal' });
  expect(results[1]).toMatchObject({ completion: 'throw', errorClass: 'ReferenceError', bodyEntered: true });
});

test('a decorator failure leaves the outer class unavailable', () => {
  const results = sequence('function fail(c,ctx){throw new Error("decorator");}@fail class V{}', 'V;', 'const t=type V;');
  expect(results[0]).toMatchObject({ completion: 'throw', errorClass: 'Error', bodyEntered: true });
  for (const result of results.slice(1)) {
    expect(result).toMatchObject({ completion: 'throw', errorClass: 'ReferenceError', bodyEntered: true });
    expect(result.message).toContain('cannot be used before initialization');
  }
});

test('successful replacement decoration retains the declared contract', () => {
  const results = sequence('let original;function decorate(ctx){original=ctx.type;return class extends ctx.type{};}@decorate class V{}const Decorated=V;',
    'V=class {};', 'const v:V=new original();String(type V===original)+"/"+String(type V===Decorated);');
  for (const result of results) expect(result).toMatchObject({ completion: 'normal', errorClass: undefined });
  expect(results[2].value).toBe('true/false');
});

test('the decorator receives its class through context while the outer binding is in TDZ', () => {
  const results = sequence('let pending=false;function decorate(ctx){try{V;}catch(e){pending=e instanceof ReferenceError;}}@decorate class V{}String(pending);');
  expect(results[0]).toMatchObject({ completion: 'normal', value: 'true' });
});

test('a decorator initializer failure leaves the outer class unavailable', () => {
  const results = sequence('function decorate(ctx){ctx.addInitializer(()=>{throw new Error("initializer");});}@decorate class V{}', 'V;', 'const t=type V;');
  expect(results[0]).toMatchObject({ completion: 'throw', errorClass: 'Error', bodyEntered: true });
  for (const result of results.slice(1)) {
    expect(result).toMatchObject({ completion: 'throw', errorClass: 'ReferenceError', bodyEntered: true });
    expect(result.message).toContain('cannot be used before initialization');
  }
});

test('a failed local activation cannot discard another activation', () => {
  const results = sequence(`
    function make(fail){
      const accept=(x:any)=>{const c:C=x;return c;};
      class C{static{if(fail)throw new Error("failed");}}
      const Original=C;C=class {};return {Original,accept};
    }
    const good=make(false);try{make(true);}catch(e){}
  `, 'good.accept(new good.Original());"ok";');
  for (const result of results) expect(result).toMatchObject({ completion: 'normal', errorClass: undefined });
  expect(results[1].value).toBe('ok');
});

test('recursive local classes keep their own declaration denotation', () => {
  expect(sequence(`
    function make(n){class C{}const Original=C;const inner=n?make(n-1):null;C=class {};return {Original,inner,denote:()=>type C};}
    const outer=make(1);
    String(outer.denote()===outer.Original&&outer.inner.denote()===outer.inner.Original&&outer.denote()!==outer.inner.denote());
  `)[0]).toMatchObject({ completion: 'normal', value: 'true' });
});

test('interleaved generator activations retain their denotation across suspension', () => {
  expect(sequence(`
    function* make(){class C{}yield ()=>type C;C=class {};yield ()=>type C;}
    const a=make(),b=make();const a1=a.next().value,b1=b.next().value,a2=a.next().value,b2=b.next().value;
    String(a1()===a2()&&b1()===b2()&&a1()!==b1());
  `)[0]).toMatchObject({ completion: 'normal', value: 'true' });
});

test.each(['named', 'default named', 'default anonymous'])('%s decorated export retains the original declaration contract', async (form) => {
  const declaration = form === 'named' ? 'export class V{}' : form === 'default named' ? 'export default class V{}' : 'export default class {}';
  const imports = form === 'named' ? 'import {V as C,original} from "dep";' : 'import C,{original} from "dep";';
  expect(await observeModuleGraph({
    dep: `export let original;function decorate(ctx){original=ctx.type;return class extends ctx.type{};}@decorate ${declaration}`,
    main: `${imports}const c:C=new original();if(type C!==original||C===original)throw new Error("decorated export");`,
  })).toMatchObject({ status: 'fulfilled', errorClass: undefined });
});

test.each(['named', 'default named', 'default anonymous'])('%s export fails before publication when a decorator throws', async (form) => {
  const declaration = form === 'named' ? 'export class V{}' : form === 'default named' ? 'export default class V{}' : 'export default class {}';
  expect(await observeModuleGraph({
    dep: `function fail(ctx){throw new Error("decorator");}@fail ${declaration}`,
    main: 'import * as ns from "dep";throw new TypeError("consumer ran");',
  })).toMatchObject({ status: 'rejected', errorClass: 'Error', bodyEntries: ['dep'] });
});
