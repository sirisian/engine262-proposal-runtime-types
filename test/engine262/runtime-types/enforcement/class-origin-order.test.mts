import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';

function observe(source: string) {
  const result = observeScript(source);
  return { bodyEntered: result.bodyEntered, errorClass: result.errorClass,
    completion: result.completion.Type, message: (result.completion.Value as { HostDefinedMessageString?: string })?.HostDefinedMessageString,
    value: result.completion.Type === 'normal' ? (result.completion.Value as { stringValue?(): string })?.stringValue?.() : undefined };
}

test.each([
  ['later eval', 'class A{constructor(n:number){}}class B extends A{}new B("bad");eval("1");'],
  ['unused eval closure', 'class A{constructor(n:number){}}class B extends A{}new B("bad");function unused(){eval("1");}'],
  ['later binding write', 'class A{constructor(n:number){}}class B extends A{}new B("bad");A=class{};'],
  ['captured heritage', 'class A{constructor(n:number){}}class B extends A{}A=class{};new B("bad");'],
  ['immutable constructor snapshot', 'class A{constructor(n:number){}}const Saved=A;A=class{};class B extends Saved{}new B("bad");'],
  ['same-spelled block write', 'class A{constructor(n:number){}}{let A;A=1;}class B extends A{}new B("bad");'],
  ['unused captured writer', 'class A{constructor(n:number){}}function unused(){A=class{};}class B extends A{}new B("bad");'],
  ['replacement constructor operand', 'class A{}class B{}A=B;const x:A=new A();'],
  ['replacement heritage operand', 'class A{}class B{}A=B;class C extends A{}const x:A=new C();'],
  ['mutable alias replacement', 'class A{}class B{}let Selected=A;Selected=B;const x:A=new Selected();'],
  ['selected true branch', 'class A{}class B{}let Selected=A;if(true)Selected=B;const x:A=new Selected();'],
  ['matching branch origins', 'function f(flag){class A{}class B{}let Selected=A;if(flag)Selected=B;else Selected=B;const x:A=new Selected();}f(true);'],
  ['comma assignment result', 'class A{}class B{}let Selected=A;const Stable=(Selected=B,Selected);const x:A=new Stable();'],
  ['conditional result', 'class A{}class B{}const Stable=true?B:A;const x:A=new Stable();'],
  ['local class inaccessible to callback', 'function f(cb){class A{constructor(n:number){}}cb();class B extends A{}new B("bad");}f(()=>{});'],
  ['immutable capture across callback', 'class A{constructor(n:number){}}const Saved=A;unknown();class B extends Saved{}new B("bad");'],
  ['unrelated local pattern write', 'function f(){class A{constructor(n:number){}}let x;[x]=[1];class B extends A{}new B("bad");}f();'],
  ['unrelated loop shadow write', 'function f(){class A{constructor(n:number){}}for(let i=0;i<2;i++){let A;A=1;}class B extends A{}new B("bad");}f();'],
  ['global dynamic code cannot reach an unexposed local', 'function f(){class A{constructor(n:number){}}Function("return 0")();class B extends A{}new B("bad");}f();'],
  ['local const capture survives direct eval', 'function f(){class A{constructor(n:number){}}const Saved=A;eval("A=class{}");class B extends Saved{}new B("bad");}f();'],
  ['global dynamic code cannot reach a block-local class', '{class A{constructor(n:number){}}Function("return 0")();class B extends A{}new B("bad");}'],
])('%s establishes its failure before body entry', (_name, source) => {
  const result = observe(source!);
  expect(result).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', completion: 'throw' });
});

test.each([
  ['saved original after replacement', 'class A{}const Saved=A;A=class{};class B extends Saved{}const x:A=new B();"ok";', 'ok'],
  ['later unrelated eval', 'class A{}class B extends A{}const x:A=new B();eval("1");"ok";', 'ok'],
  ['constructor captured before arguments', 'class A{constructor(n:number){}}class B{constructor(s:string){}}let Selected=A;const x:A=new Selected((Selected=B,1));String(Selected===B);', 'true'],
  ['heritage captured before computed name', 'class A{}const Saved=A;class B extends A{[(A=class{},"m")](){}}const x:A=new B();String(B.prototype instanceof Saved);', 'true'],
  ['heritage captured before static initializer', 'class A{}const Saved=A;class B extends A{static{A=class{};}}const x:A=new B();String(B.prototype instanceof Saved);', 'true'],
  ['skipped branch write', 'class A{}class B{}let Selected=A;if(false)Selected=B;const x:A=new Selected();"ok";', 'ok'],
  ['short-circuit skipped write', 'function f(flag){class A{}class B{}let Selected=A;flag&&(Selected=B);const x:A=new Selected();return "ok";}f(false);', 'ok'],
  ['distinct shadow origin', 'class A{}const Saved=A;{class A{}A=class{};}const x:Saved=new Saved();"ok";', 'ok'],
  ['callback can replace global constructor', 'class A{}const Saved=A;function change(){A=class extends Saved{};}change();class B extends A{}const x:Saved=new B();"ok";', 'ok'],
  ['getter replaces future constructor read', 'class A{constructor(n:number){}}const box={get value(){A=class{constructor(s:string){}};return 0;}};box.value;class B extends A{}new B("ok");"ok";', 'ok'],
  ['direct eval changes local origin', 'function f(){class A{constructor(n:number){}}eval("A=class{constructor(s:string){}}");class B extends A{}new B("ok");return "ok";}f();', 'ok'],
  ['a bound eval name may still call intrinsic direct eval', 'const run=globalThis.eval;function f(){const eval=run;class A{constructor(n:number){}}eval("A=class{constructor(s:string){}}");class B extends A{}new B("ok");return "ok";}f();', 'ok'],
  ['indirect eval changes global origin', 'class A{constructor(n:number){}}(0,eval)("A=class{constructor(s:string){}}");class B extends A{}new B("ok");"ok";', 'ok'],
  ['dynamic function changes global origin', 'class A{constructor(n:number){}}Function("A=class{constructor(s:string){}}")();class B extends A{}new B("ok");"ok";', 'ok'],
  ['global property is not a lexical class binding', 'class A{constructor(n:number){}}globalThis.A=class{};class B extends A{}new B(1);"ok";', 'ok'],
  ['captured local writer', 'function f(cb){class A{constructor(n:number){}}function change(){A=class{constructor(s:string){}};}cb(change);class B extends A{}new B("ok");return "ok";}f(fn=>fn());', 'ok'],
  ['parameter default precedes body', 'class A{constructor(n:number){}}function f(x=(A=class{constructor(s:string){}})){class B extends A{}new B("ok");return "ok";}f();', 'ok'],
  ['class self binding survives outer replacement', 'class A{static make(){return new A();}}const Saved=A;A=class{};const x:Saved=Saved.make();"ok";', 'ok'],
  ['unknown member is not proved truthy', 'function f(){class A{}class B{}let Selected=A;const box={x:0};const maybe=box.x;maybe||(Selected=B);const x:B=new Selected();return "ok";}f();', 'ok'],
  ['mapped arguments are not constructor-origin storage', 'class A{}class B{}function f(C){type Check=string;C=A;arguments[0]=B;return new C();}String(f(A) instanceof B);', 'true'],
  ['strict arguments remain unmapped', 'class A{}class B{}function f(C){"use strict";C=A;arguments[0]=B;return new C();}String(f(A) instanceof B);', 'false'],
  ['pattern write withdraws the destination origin', 'function f(){class A{}class B{}let Selected=A;[Selected]=[B];const x:B=new Selected();return "ok";}f();', 'ok'],
  ['sloppy eval injection shadows an outer immutable alias', 'const Saved=class{constructor(n:number){}};function f(){type Checked=string;eval("var Saved=class{constructor(s:string){}}");class B extends Saved{}new B("ok");return "ok";}f();', 'ok'],
  ['suspension withdraws an exposed local origin', 'let change;function* f(){class A{constructor(n:number){}}change=()=>{A=class{constructor(s:string){}};};yield 0;class B extends A{}new B("ok");return "ok";}const g=f();g.next();change();g.next().value;', 'ok'],
])('%s retains ordinary execution', (_name, source, expected) => {
  const result = observe(source!);
  expect(result).toMatchObject({ bodyEntered: true, errorClass: undefined, completion: 'normal', value: expected });
});

test('generic specialization effects precede a later ordinary read', () => {
  expect(observe('function f(){class A{}let Selected=A;class G<T:type>{static{Selected=class{};}}Selected=A;const t=type G.<string>;const x:A=new Selected();}f();'))
    .toMatchObject({ bodyEntered: true, errorClass: 'TypeError', completion: 'throw' });
});

test('decorated exports retain only the allowed replacement bound', async () => {
  expect(await observeModuleGraph({
    dep: 'function decorate(ctx){return class extends ctx.type{constructor(s:string){super(1);}};}@decorate export class A{constructor(n:number){}}',
    main: 'import {A} from "dep";class B extends A{}new B("ok");',
  })).toMatchObject({ status: 'fulfilled', errorClass: undefined });
});

test.each([
  ['unknown call before heritage', 'class A{}function change(){A=class{};}change();class B extends A{}const x:A=new B();'],
  ['unknown call before construction', 'class A{}function change(){A=class{};}change();const x:A=new A();'],
  ['direct eval before construction', 'class A{}eval("A=class{}");const x:A=new A();'],
  ['repeated loop writes', 'class A{}class B{}let Selected=A;for(let i=0;i<2;i++){const x:A=new Selected();Selected=B;}'],
])('%s retains runtime admission', (_name, source) => {
  const result = observe(source!);
  expect(result).toMatchObject({ bodyEntered: true, errorClass: 'TypeError', completion: 'throw' });
});
