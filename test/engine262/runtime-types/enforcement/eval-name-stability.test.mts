import { expect, test } from 'vitest';
import { observeScript, type ScriptCheckingMode } from '../harness.mts';

// Type evidence must not replace ordinary evaluation or change execution mode.
test.each([
  ['sloppy declaration injection', 'function make(){return 1;}function f(){eval("var make=()=>2");return String(make());}f();', '2'],
  ['implicit strict any', 'function make(){return 1;}function f(){eval("var make=()=>2");const r:any=make();return String(r);}f();', '1'],
  ['implicit strict uint8', 'function make(){return 1;}function f(){eval("var make=()=>2");const r:uint8=make();return String(r);}f();', '1'],
  ['strict assignment is live', 'function make(){return 1;}function f(){eval("make=()=>2");const r:any=make();return String(r);}f();', '2'],
  ['constructor declaration isolation', 'class V{m(){return 1;}}function f(){eval("var V=class{m(){return 2;}}");const o:any=new V();return String(o.m());}f();', '1'],
  ['constructor assignment is live', 'class V{m(){return 1;}}function f(){eval("V=class{m(){return 2;}}");const o:any=new V();return String(o.m());}f();', '2'],
  ['checked sloppy remains sloppy', 'function make(){return 1;}function f(){type Marker=string;eval("var make=()=>2");return String(make());}f();', '2'],
  ['alias scope in strict eval', 'type T=string;function f(){eval("var T=1");const t:T="x";return t;}f();', 'x'],
  ['initializer runs once per call', 'let calls=0;function make(){calls++;return calls;}function f(){const r:any=make();return String(r);}f()+","+f()+","+calls;', '1,2,2'],
  ['unused initializer does not run', 'let calls=0;function make(){calls++;return calls;}function f(){const r:any=make();return r;}String(calls);', '0'],
  ['callee captured before arguments', 'function first(){return "first";}let selected=first;function change(){selected=()=>"second";return 0;}const result:any=selected(change());String(result);', 'first'],
  ['unexecuted eval is not parsed eagerly', 'function f(){const n:any=1;eval("var =");} "ok";', 'ok'],
])('%s', (_name, source, expected) => {
  const result = observeScript(source!);
  expect(result).toMatchObject({ bodyEntered: true, errorClass: undefined, completion: { Type: 'normal' } });
  expect((result.completion.Value as { stringValue(): string }).stringValue()).toBe(expected);
});

test.each(['automatic', 'disabled'] as ScriptCheckingMode[])('explicit strict control (%s)', (mode) => {
  const result = observeScript('function make(){return 1;}function f(){"use strict";eval("var make=()=>2");return String(make());}f();', mode);
  expect(result.completion.Type).toBe('normal');
  expect((result.completion.Value as { stringValue(): string }).stringValue()).toBe('1');
});

test.each([
  ['prototype obligations retain compatible relinking', `
    class V {} class W extends V {}
    const v: V = new W(); eval("1");
    const compatible = Reflect.setPrototypeOf(W.prototype, Object.create(V.prototype));
    const incompatible = Reflect.setPrototypeOf(W.prototype, Object.prototype);
    String(compatible) + "/" + String(incompatible) + "/" + String(v instanceof V);
  `, 'true/false/true'],
  ['removal through eval still invalidates a reference', `
    class V {} class W extends V {}
    const v: V = new W();
    let a: [].<uint8> = [1]; let ref r = a[0];
    eval("a.pop()");
    let error = "none";
    try { const read: any = r; } catch (e) { error = e instanceof TypeError ? "TypeError" : "other"; }
    String(a.length) + "/" + error;
  `, '0/TypeError'],
  ['runtime admission follows the actual constructor effects', `
    let calls = 0; class V {}
    eval("V=class {constructor(){calls++;}}");
    class W extends V {}
    let error = "none";
    try { const v: V = new W(); } catch (e) { error = e instanceof TypeError ? "TypeError" : "other"; }
    String(calls) + "/" + error;
  `, '1/TypeError'],
])('%s', (_name, source, expected) => {
  const result = observeScript(source!);
  expect(result.completion.Type).toBe('normal');
  expect((result.completion.Value as { stringValue(): string }).stringValue()).toBe(expected);
});

// Loss of a base origin is unknown evidence, not a negative nominal proof.
test.each([
  ['later harmless eval', 'class V{}class W extends V{}const v:V=new W();eval("1");'],
  ['strict local eval', 'function f(){"use strict";class V{}class W extends V{}eval("1");const v:V=new W();}f();'],
  ['unused eval', 'class V{}class W extends V{}const v:V=new W();function unused(){eval("1");}'],
  ['unrelated eval scope', 'function f(){class V{}class W extends V{}const v:V=new W();}function other(){eval("1");}f();'],
  ['later assignment', 'class V{}class W extends V{}const v:V=new W();V=class {};'],
  ['assignment after heritage', 'class V{}class W extends V{}V=class {};const v:V=new W();'],
  ['eval assignment after heritage', 'class V{}class W extends V{}eval("V=class {}");const v:V=new W();'],
  ['indirect eval assignment', 'class V{}class W extends V{}(0,eval)("V=class {}");const v:V=new W();'],
  ['dynamic function assignment', 'class V{}class W extends V{}Function("V=class {}")();const v:V=new W();'],
  ['multi-level ancestry', 'class V{}class W extends V{}class X extends W{}const v:V=new X();eval("1");'],
  ['class expression ancestry', 'class V{}const W=class extends V{};const v:V=new W();eval("1");'],
  ['specialized ancestry', 'class V{}class W<T:type> extends V{}const v:V=new W.<number>();eval("1");'],
  ['union target', 'class V{}class W extends V{}const v:V|null=new W();eval("1");'],
  ['union source', 'class V{}class W extends V{}const v:V|null=true?new W():null;eval("1");'],
  ['intersection target', 'class V{}class W extends V{}const v:V&object=new W();eval("1");'],
  ['return boundary', 'class V{}class W extends V{}function f():V{return new W();}eval("1");f();'],
  ['argument boundary', 'class V{}class W extends V{}function f(v:V){}eval("1");f(new W());'],
  ['assignment boundary', 'class V{}class W extends V{}let v:V=new V();v=new W();eval("1");'],
])('%s retains runtime admission', (_name, source) => {
  expect(observeScript(source!)).toMatchObject({ bodyEntered: true, errorClass: undefined, completion: { Type: 'normal' } });
});

test.each([
  ['replaced base before heritage', 'class V{}eval("V=class {}");class W extends V{}const v:V=new W();', 'TypeError'],
  ['indirect replacement before heritage', 'class V{}Function("V=class {}")();class W extends V{}const v:V=new W();', 'TypeError'],
  ['prototype detached before admission', 'class V{}class W extends V{}Object.setPrototypeOf(W.prototype,Object.prototype);const v:V=new W();eval("1");', 'TypeError'],
  ['prototype obligation after admission', 'class V{}class W extends V{}const v:V=new W();eval("1");Object.setPrototypeOf(W.prototype,Object.prototype);', 'TypeError'],
  ['numeric eval store', 'let x:uint8=5;eval("x=300");', 'RangeError'],
  ['replaced callable result', `function g(n:uint8):uint8{return n;}eval('g=(n)=>"s"');const r:uint8=g(1);`, 'TypeError'],
  ['alias remains immutable', 'type T=string;eval("T=uint8");', 'TypeError'],
  ['added value storage', 'class V{x:uint8=1;}class W extends V{y:uint8=2;}const v:V=new W();eval("1");', 'TypeError'],
])('%s fails at runtime', (_name, source, errorClass) => {
  expect(observeScript(source!)).toMatchObject({ bodyEntered: true, errorClass, completion: { Type: 'throw' } });
});

test.each([
  ['unrelated classes', 'class V{}class X{}const v:V=new X();eval("1");'],
  ['known null heritage', 'class V{}class W extends (null){constructor(){return Object.create(new.target.prototype);}}const v:V=new W();eval("1");'],
  ['known primitive mismatch', 'class V{}class W extends V{}const v:number=new W();eval("1");'],
  ['same family arguments', 'class V{}class W<T:type> extends V{}const v:W.<string> = new W.<number>();eval("1");'],
  ['own field contract', 'class V{}class W extends V{field:uint8=1;}const v:string=new W().field;eval("1");'],
  ['known added value storage', 'class V{x:uint8=1;}class W extends V{y:uint8=2;}const v:V=new W();'],
  ['known invalid union alternative', 'class V{}class W extends V{}const v:V=true?new W():"invalid";eval("1");'],
  ['bad annotation', 'class V{}class W extends V{}const v:Missing=new W();eval("1");'],
])('%s is still refused before body entry', (_name, source) => {
  const result = observeScript(source!);
  expect(result).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', completion: { Type: 'throw' } });
  expect(result.diagnostic?.rule).toBe(_name === 'bad annotation' ? 'rt-type-evaluation' : 'rt-assignability');
});
