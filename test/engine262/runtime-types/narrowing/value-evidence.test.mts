import { expect, test } from 'vitest';
import { expectStaticTypeError, evaluated, settledAfterJobs } from '../harness.mts';

// #sec-narrowing-flow, #sec-narrowfrom, #sec-divergence.

test("saved-predicate: if", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:boolean=x is uint8;if(b){if(x is string){}}}");
});

test("saved-predicate: while", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:boolean=x is uint8;while(b){if(x is string){}break;}}");
});

test("saved-predicate: switch", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:boolean=x is uint8;switch(b){case true:if(x is string){}break;}}");
});

test("saved-predicate: guard", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:boolean=x is uint8;return match(0){when _ if(b): x is string ? 1:2;default:0;};}");
});

test("saved-predicate: for-of", () => {
  expectStaticTypeError("function f(x:uint8|string,ys:[].<uint8>){const b:boolean=x is uint8;for(const y of ys){if(b){if(x is string){}}}}");
});

test("saved-predicate: for-await", () => {
  expectStaticTypeError("async function f(x:uint8|string,ys:[].<uint8>){const b:boolean=x is uint8;for await(const y of ys){if(b){if(x is string){}}}}");
});

test("saved-predicate: inline", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8){if(x is string){}}}");
});

test("saved-predicate: source-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){const b:boolean=x is uint8;x=y;if(b){if(x is string){}}}");
});

test("saved-predicate: alias-write", () => {
  evaluated("function f(x:uint8|string,b:boolean){let saved:boolean=x is uint8;saved=b;if(saved){if(x is string){}}}");
});

test("saved-predicate: reference-call", () => {
  evaluated("function f(ref x:uint8|string,g:any){const b:boolean=x is uint8;g();if(b){if(x is string){}}}");
});

test("saved-predicate: unrelated", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){const b:boolean=y is uint8;if(b){if(x is string){}}}");
});

test("stored-domain: assignment", () => {
  expectStaticTypeError("function f(x:uint8|string){x=uint8(1);if(x is string){}}");
});

test("stored-domain: initializer", () => {
  expectStaticTypeError("function f(){let x:uint8|string=uint8(1);if(x is string){}}");
});

test("stored-domain: joined-stores", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(b)x=uint8(1);else x=uint8(2);if(x is string){}}");
});

test("stored-domain: nullish-store", () => {
  expectStaticTypeError("function f(x:{v:uint8}|null){x??={v:1};if(x is null){}}");
});

test("stored-domain: catch-store", () => {
  expectStaticTypeError("function f(g:any){try{g();}catch(e:uint8|string){e=uint8(1);if(e is string){}}}");
});

test("stored-domain: retained-fact", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8){x=uint8(1);if(x is string){}}}");
});

test("stored-domain: union-source", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){x=y;if(x is string){}}");
});

test("stored-domain: one-sided-store", () => {
  evaluated("function f(x:uint8|string,b:boolean){if(b)x=uint8(1);if(x is string){}}");
});

test("stored-domain: closure-write", () => {
  evaluated("function f(x:uint8|string){function change(){x=\"s\";}x=uint8(1);change();if(x is string){}}");
});

test("coalesced-truthiness: false-edge", () => {
  expectStaticTypeError("function f(b:boolean|null){if(b??true){}else{if(b===true){}}}");
});

test("coalesced-truthiness: for-body", () => {
  expectStaticTypeError("function f(b:boolean|null){for(;b??false;){if(b===false){}break;}}");
});

test("coalesced-truthiness: do-exit", () => {
  expectStaticTypeError("function f(b:boolean|null){do{}while(b??true);if(b===true){}}");
});

test("coalesced-truthiness: finally", () => {
  expectStaticTypeError("function f(b:boolean|null){try{if(b??true)return;}finally{}if(b===true){}}");
});

test("coalesced-truthiness: bare-boolean", () => {
  expectStaticTypeError("function f(b:boolean){if(b){}else{if(b===true){}}}");
});

test("coalesced-truthiness: fallback-false", () => {
  evaluated("function f(b:boolean|null){if(b??false){}else{if(b is null){}}}");
});

test("coalesced-truthiness: fallback-true", () => {
  evaluated("function f(b:boolean|null){if(b??true){if(b is null){}}}");
});

test("coalesced-truthiness: write", () => {
  evaluated("function f(b:boolean|null,c:boolean|null){if(b??false){b=c;if(b===false){}}}");
});

test("optional-typeof: if", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){if(typeof o?.tag===\"string\"){if(o is null){}}}");
});

test("optional-typeof: switch", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){switch(typeof o?.tag){case \"string\":if(o is null){}break;}}");
});

test("optional-typeof: and", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){if(typeof o?.tag===\"string\" && (o is null)){}}");
});

test("optional-typeof: direct-result", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){if(o?.tag!==undefined){if(o is null){}}}");
});

test("optional-typeof: undefined-tag", () => {
  evaluated("function f(o:{tag:string|undefined}|null){if(typeof o?.tag===\"undefined\"){if(o is null){}}}");
});

test("optional-typeof: later-write", () => {
  evaluated("function f(o:{tag:string}|null,p:{tag:string}|null){if(typeof o?.tag===(o=p,\"string\")){if(o is null){}}}");
});

test("optional-typeof: accessor", () => {
  evaluated("function f(box:{readonly value:{tag:string}|null}){if(typeof box.value?.tag===\"string\"){if(box.value is null){}}}");
});

test("generic-proof: boolean", () => {
  expectStaticTypeError("function f<T:type extends boolean>(b:T){if(b){if(b===false){}}}");
});

test("generic-proof: nullish", () => {
  expectStaticTypeError("function f<T:type extends string|null>(x:T){if(x!==null){if(x is null){}}}");
});

test("generic-proof: for", () => {
  expectStaticTypeError("function f<T:type extends uint8|string>(x:T){for(;x is uint8;){if(x is string){}break;}}");
});

test("generic-proof: whole-bound", () => {
  expectStaticTypeError("function f<T:type extends uint8>(x:T){if(x is string){}}");
});

test("generic-proof: unbounded", () => {
  evaluated("function f<T:type>(x:T){if(x is string){}}");
});

test("generic-proof: reassignment", () => {
  evaluated("function f<T:type extends uint8|string>(x:T,y:T){if(x is uint8){x=y;if(x is string){}}}");
});

test("generic-proof: identity", () => {
  evaluated("function f<T:type extends uint8|string>(x:T):T{if(x is uint8)return x;return x;}");
});

test("library-partition: array-true", () => {
  expectStaticTypeError("function f(x:string|[].<uint8>){if(Array.isArray(x)){if(x is string){}}}");
});

test("library-partition: number-false", () => {
  expectStaticTypeError("function f(x:string|uint8){if(Number.isInteger(x)){}else{if(x is uint8){}}}");
});

test("library-partition: while", () => {
  expectStaticTypeError("function f(x:string|uint8){while(Number.isInteger(x)){if(x is string){}break;}}");
});

test("library-partition: constant-answer", () => {
  expectStaticTypeError("function f(x:string){if(Array.isArray(x)){}}");
});

test("library-partition: shadow", () => {
  evaluated("function f(Array:any,x:string|[].<uint8>){if(Array.isArray(x)){if(x is string){}}}");
});

test("library-partition: float-alternative", () => {
  evaluated("function f(x:string|float64){if(Number.isInteger(x)){}else{if(x is float64){}}}");
});

test("library-partition: write", () => {
  evaluated("function f(x:string|[].<uint8>,y:string|[].<uint8>){if(Array.isArray(x)){x=y;if(x is string){}}}");
});

test("presence-partition: else", () => {
  expectStaticTypeError("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A|B){if(\"x\" in v){}else{if(v is A){}}}");
});

test("presence-partition: and", () => {
  expectStaticTypeError("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A|B){if(!(\"x\" in v) && (v is A)){}}");
});

test("presence-partition: for", () => {
  expectStaticTypeError("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A|B){for(;!(\"x\" in v);){if(v is A){}break;}}");
});

test("presence-partition: for-in", () => {
  expectStaticTypeError("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A|B,o:{a:uint8}){for(const k in o){if(!(\"x\" in v)){if(v is A){}}}}");
});

test("presence-partition: known-member", () => {
  expectStaticTypeError("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A){if(\"x\" in v){}}");
});

test("presence-partition: present-both", () => {
  evaluated("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A|B){if(\"x\" in v){if(v is B){}}}");
});

test("presence-partition: unknown-key", () => {
  evaluated("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A|B,k:string){if(k in v){}else{if(v is A){}}}");
});

test("presence-partition: write", () => {
  evaluated("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A|B,w:A|B){if(\"x\" in v){}else{v=w;if(v is A){}}}");
});

test("literal-exclusion: else-if", () => {
  expectStaticTypeError("function f(x:string){if(x===\"a\"){}else if(x===\"a\"){}}");
});

test("literal-exclusion: early-return", () => {
  expectStaticTypeError("function f(x:number){if(x===0)return;if(x===0){}}");
});

test("literal-exclusion: loop-exit", () => {
  expectStaticTypeError("function f(x:string,g:()=>string){while(x===\"a\"){x=g();}if(x===\"a\"){}}");
});

test("literal-exclusion: match", () => {
  expectStaticTypeError("function f(x:string){return match(x){when \"a\":1;default:x===\"a\"?2:3;};}");
});

test("literal-exclusion: labelled-block", () => {
  expectStaticTypeError("function f(x:string){outer:{if(x===\"a\")break outer;if(x===\"a\"){}}}");
});

test("literal-exclusion: finite-domain", () => {
  expectStaticTypeError("function f(x:\"a\"|\"b\"){if(x===\"a\"){}else if(x===\"a\"){}}");
});

test("literal-exclusion: write", () => {
  evaluated("function f(x:string,y:string){if(x===\"a\")return;x=y;if(x===\"a\"){}}");
});

test("literal-exclusion: other-value", () => {
  evaluated("function f(x:string){if(x===\"a\")return;if(x===\"b\"){}}");
});

test("literal-exclusion: join", () => {
  evaluated("function f(x:string,b:boolean){if(b){if(x===\"a\")return;}if(x===\"a\"){}}");
});

test("switch-domain: case-left", () => {
  expectStaticTypeError("function f(x:string|boolean,y:string|uint8){switch(x){case y:if(x is boolean){}break;}}");
});

test("switch-domain: case-right", () => {
  expectStaticTypeError("function f(x:string|boolean,y:string|uint8){switch(x){case y:if(y is uint8){}break;}}");
});

test("switch-domain: case-loop", () => {
  expectStaticTypeError("function f(x:string|boolean,y:string|uint8){switch(x){case y:while(x is boolean){break;}break;}}");
});

test("switch-domain: equality", () => {
  expectStaticTypeError("function f(x:string|boolean,y:string|uint8){if(x===y){if(x is boolean){}}}");
});

test("switch-domain: fallthrough", () => {
  evaluated("function f(x:string|boolean,y:string|uint8){switch(x){case true:case y:if(x is boolean){}break;}}");
});

test("switch-domain: label-write", () => {
  evaluated("function f(x:string|boolean,y:string|uint8,z:string|boolean){switch(x){case (x=z,y):if(x is boolean){}break;}}");
});

test("switch-domain: default", () => {
  evaluated("function f(x:string|boolean,y:string|uint8){switch(x){case y:break;default:if(x is string){}break;}}");
});

test("awaited-result: await-true", () => {
  expectStaticTypeError("async function f(p:Promise.<true>){if(await p){}}");
});

test("awaited-result: await-false-loop", () => {
  expectStaticTypeError("async function f(p:Promise.<false>){while(await p){}}");
});

test("awaited-result: await-never", () => {
  expectStaticTypeError("async function stop():Promise.<never>{throw 0;}async function f(x:uint8|string){if(x is uint8)await stop();if(x is uint8){}}");
});

test("awaited-result: read-result", () => {
  expectStaticTypeError("async function f(p:Promise.<true>){const b:true=await p;if(b){}}");
});

test("awaited-result: boolean-result", () => {
  evaluated("async function f(p:Promise.<boolean>){if(await p){}}");
});

test("awaited-result: unawaited-never", () => {
  evaluated("async function stop():Promise.<never>{throw 0;}function f(x:uint8|string){if(x is uint8)stop();if(x is uint8){}}");
});

test("awaited-result: caught-rejection", () => {
  evaluated("async function stop():Promise.<never>{throw 0;}async function f(x:uint8|string){try{if(x is uint8)await stop();}catch(e){}if(x is uint8){}}");
});

test("saved-boolean-retest", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:boolean=x is uint8;if(b){if(b){}}}");
});

test("saved-negated", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:boolean=!(x is uint8);if(!b){if(x is string){}}}");
});

test("saved-shadow-subject", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){const b:boolean=x is uint8;{let x:uint8|string=y;if(b){if(x is string){}}}}");
});

test("saved-shadow-guard", () => {
  evaluated("function f(x:uint8|string,y:boolean){const b:boolean=x is uint8;{const b:boolean=y;if(b){if(x is string){}}}}");
});

test("saved-call-mutation", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){const b:boolean=x is uint8;function g(){x=y;}g();if(b){if(x is string){}}}");
});

test("saved-loop-backedge", () => {
  evaluated("function f(x:uint8|string,y:uint8|string,b:boolean){const p:boolean=x is uint8;while(b){if(p){if(x is string){}}x=y;}}");
});

test("store-after-saved", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:boolean=x is uint8;x=uint8(1);if(x is string){}}");
});

test("store-untyped", () => {
  evaluated("function f(){let x=1;if(x is string){}}");
});

test("store-contract-retained", () => {
  evaluated("function f(x:uint8|string){x=uint8(1);x=\"a\";return x;}");
});

test("store-numeric-adoption", () => {
  expectStaticTypeError("function f(){let x:uint8|string=1;if(x is string){}}");
});

test("store-or", () => {
  expectStaticTypeError("function f(x:{v:uint8}|null){x||={v:1};if(x is null){}}");
});

test("store-and", () => {
  evaluated("function f(x:uint8|string){x&&=uint8(1);if(x is string){}}");
});

test("store-changed-root", () => {
  evaluated("class A{x:uint8|string=\"a\";}function f(a:A,b:A){a.x=(a=b,uint8(1));if(a.x is string){}}");
});

test("coalesce-false-part", () => {
  expectStaticTypeError("function f(b:boolean|null){if(b??false){if(b===false){}}}");
});

test("coalesce-true-part", () => {
  expectStaticTypeError("function f(b:boolean|null){if(b??true){}else{if(b===false){}}}");
});

test("optional-typeof-reversed", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){if(\"string\"===typeof (o?.tag)){if(o is null){}}}");
});

test("optional-typeof-not-equal", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){if(typeof o?.tag!==\"undefined\"){if(o is null){}}}");
});

test("optional-typeof-switch-fallthrough", () => {
  evaluated("function f(o:{tag:string}|null){switch(typeof o?.tag){case \"undefined\":case \"string\":if(o is null){}break;}}");
});

test("generic-else", () => {
  expectStaticTypeError("function f<T:type extends boolean>(b:T){if(b){}else{if(b===true){}}}");
});

test("generic-join", () => {
  evaluated("function f<T:type extends uint8|string>(x:T,b:boolean){if(b){if(x is uint8){}}if(x is string){}}");
});

test("generic-return", () => {
  evaluated("function f<T:type extends boolean>(x:T):T{if(x)return x;return x;}");
});

test("generic-ref-call", () => {
  evaluated("function f<T:type extends string|null>(ref x:T,g:()=>void){if(x!==null){g();if(x is null){}}}");
});

test("library-array-false", () => {
  expectStaticTypeError("function f(x:string|[].<uint8>){if(Array.isArray(x)){}else{if(x is [].<uint8>){}}}");
});

test("library-unknown-member", () => {
  evaluated("function f(x:object|string){if(Array.isArray(x)){if(x is object){}}}");
});

test("library-replacement", () => {
  evaluated("Array.isArray=(x:any)=>true;function f(x:string|[].<uint8>){if(Array.isArray(x)){if(x is string){}}}");
});

test("exclusion-negative-zero", () => {
  expectStaticTypeError("function f(x:number){if(x===-0)return;if(x===+0){}}");
});

test("exclusion-pattern-zero", () => {
  expectStaticTypeError("function f(x:number){return match(x){when 0:1;default:x===-0?2:3;};}");
});

test("exclusion-pattern-signed-zero", () => {
  evaluated("function f(x:number){return match(x){when -0:1;default:x===0?2:3;};}");
});

test("exclusion-pattern-repeat", () => {
  expectStaticTypeError("function f(x:string){return match(x){when \"a\":1;when \"a\":2;default:3;};}");
});

test("exclusion-is-pattern", () => {
  expectStaticTypeError("function f(x:string){if(x is \"a\")return;if(x===\"a\"){}}");
});

test("exclusion-common-join", () => {
  expectStaticTypeError("function f(x:string,b:boolean){if(b){if(x===\"a\")return;}else{if(x===\"a\")return;}if(x===\"a\"){}}");
});

test("exclusion-ref-call", () => {
  evaluated("function f(ref x:string,g:()=>void){if(x===\"a\")return;g();if(x===\"a\"){}}");
});

test("exclusion-closure", () => {
  evaluated("function f(x:string){if(x===\"a\")return;function g(){x=\"a\";}g();if(x===\"a\"){}}");
});

test("exclusion-loose-coercion", () => {
  evaluated("function f(x:string|number){if(x==0)return;if(x===\"0\"){}}");
});

test("switch-right-write", () => {
  evaluated("function f(x:string|boolean,y:string|uint8,z:string|uint8){switch(x){case (y=z,y):if(y is uint8){}break;}}");
});

test("switch-earlier-write", () => {
  evaluated("function f(x:string|boolean,y:string|uint8,z:string|boolean){switch(x){case (x=z,\"a\"):break;case y:if(x is boolean){}break;}}");
});

test("await-finally", () => {
  expectStaticTypeError("async function stop():Promise.<never>{throw 0;}async function f(x:uint8|string){try{if(x is uint8)await stop();}finally{}if(x is uint8){}}");
});

test("await-unknown-result", () => {
  evaluated("async function f(p:any){if(await p){}}");
});

test("await-catch-return", () => {
  evaluated("async function stop():Promise.<never>{throw 0;}async function f():Promise.<uint8>{try{await stop();}catch(e){return 1;}}");
});

test("await-alias-effect", () => {
  evaluated("async function f(ref x:string,p:Promise.<boolean>){if(x===\"a\")return;await p;if(x===\"a\"){}}");
});

test("runtime: 01-alias", () => {
  expect(evaluated("function f(x:uint8|string){const b:boolean=x is uint8;if(b)return x is string;return true;}String(f(uint8(1)));")).toBe("false");
});

test("runtime: 01-replaced-source", () => {
  expect(evaluated("function f(x:uint8|string,y:uint8|string){const b:boolean=x is uint8;x=y;if(b)return x is string;return false;}String(f(uint8(1),\"s\"));")).toBe("true");
});

test("runtime: 01-reference-call", () => {
  expect(evaluated("let value:uint8|string=uint8(1);function change(){value=\"s\";}function f(ref x:uint8|string,g:any){const b:boolean=x is uint8;g();if(b)return x is string;return false;}String(f(ref value,change));")).toBe("true");
});

test("runtime: 02-store", () => {
  expect(evaluated("function f(x:uint8|string){x=uint8(1);return x is string;}String(f(\"s\"));")).toBe("false");
});

test("runtime: 02-closure", () => {
  expect(evaluated("function f(x:uint8|string){function change(){x=\"s\";}x=uint8(1);change();return x is string;}String(f(uint8(0)));")).toBe("true");
});

test("runtime: 02-nullish-store", () => {
  expect(evaluated("function f(x:{v:uint8}|null){x??={v:1};return x is null;}String(f(null));")).toBe("false");
});

test("runtime: 03-false-edge", () => {
  expect(evaluated("function f(b:boolean|null){if(b??true)return \"true-edge\";return String(b===true);}f(false);")).toBe("false");
});

test("runtime: 03-fallback", () => {
  expect(evaluated("function f(b:boolean|null){if(b??false)return false;return b is null;}String(f(null));")).toBe("true");
});

test("runtime: 04-typeof", () => {
  expect(evaluated("function f(o:{tag:string}|null){if(typeof o?.tag===\"string\")return o is null;return true;}String(f({tag:\"a\"}));")).toBe("false");
});

test("runtime: 04-varying-accessor", () => {
  expect(evaluated("let count=0;const box={get value():{tag:string}|null{return count++===0?{tag:\"a\"}:null;}};function f(box:{readonly value:{tag:string}|null}){count=0;if(typeof box.value?.tag===\"string\")return box.value is null;return false;}String(f(box));")).toBe("true");
});

test("runtime: 04-later-replacement", () => {
  expect(evaluated("function f(o:{tag:string}|null,p:{tag:string}|null){if(typeof o?.tag===(o=p,\"string\"))return o is null;return false;}String(f({tag:\"a\"},null));")).toBe("true");
});

test("runtime: 05-generic", () => {
  expect(evaluated("function f<T:type extends uint8|string>(x:T){if(x is uint8)return x is string;return true;}String(f.<uint8|string>(uint8(1)));")).toBe("false");
});

test("runtime: 05-generic-write", () => {
  expect(evaluated("function f<T:type extends uint8|string>(x:T,y:T){if(x is uint8){x=y;return x is string;}return false;}String(f.<uint8|string>(uint8(1),\"s\"));")).toBe("true");
});

test("runtime: 06-array", () => {
  expect(evaluated("function f(x:string|[].<uint8>){if(Array.isArray(x))return x is string;return true;}let xs:[].<uint8>=[1];String(f(xs));")).toBe("false");
});

test("runtime: 06-number", () => {
  expect(evaluated("function f(x:string|uint8){if(Number.isInteger(x))return true;return x is uint8;}String(f(\"s\"));")).toBe("false");
});

test("runtime: 06-shadow", () => {
  expect(evaluated("function f(Array:any,x:string|[].<uint8>){if(Array.isArray(x))return x is string;return false;}String(f({isArray:(v:any)=>true},\"s\"));")).toBe("true");
});

test("runtime: 07-absence", () => {
  expect(evaluated("class A{x:uint8=1;}class B{y:uint8=1;}function f(v:A|B){if(\"x\" in v)return true;return v is A;}String(f(new B()));")).toBe("false");
});

test("runtime: 07-present-subclass", () => {
  expect(evaluated("class A{x:uint8=1;}class B{y:uint8=1;}class C extends B{x:uint8=1;}function f(v:A|B){if(\"x\" in v)return v is B;return false;}String(f(new C()));")).toBe("true");
});

test("runtime: 08-excluded-value", () => {
  expect(evaluated("function f(x:string){if(x===\"a\")return true;return x===\"a\";}String(f(\"b\"));")).toBe("false");
});

test("runtime: 08-replacement", () => {
  expect(evaluated("function f(x:string,y:string){if(x===\"a\")return false;x=y;return x===\"a\";}String(f(\"b\",\"a\"));")).toBe("true");
});

test("runtime: 09-variable-label", () => {
  expect(evaluated("function f(x:string|boolean,y:string|uint8){switch(x){case y:return x is boolean;default:return true;}}String(f(\"a\",\"a\"));")).toBe("false");
});

test("runtime: 09-fallthrough", () => {
  expect(evaluated("function f(x:string|boolean,y:string|uint8){switch(x){case true:case y:return x is boolean;default:return false;}}String(f(true,\"a\"));")).toBe("true");
});

test("runtime: 09-label-replacement", () => {
  expect(evaluated("function f(x:string|boolean,y:string|uint8,z:string|boolean){switch(x){case (x=z,y):return x is boolean;default:return false;}}String(f(\"a\",\"a\",true));")).toBe("true");
});

test("runtime: 10-awaited-true", () => {
  expect(settledAfterJobs("async function one():Promise.<true>{return true;}async function f(p:Promise.<true>){return await p;}globalThis.settled=\"pending\";f(one()).then(x=>{globalThis.settled=String(x);},e=>{globalThis.settled=\"rejected\";});\"scheduled\";")).toBe("true");
});

test("runtime: 10-awaited-never", () => {
  expect(settledAfterJobs("async function stop():Promise.<never>{throw 0;}async function f(x:uint8|string){if(x is uint8)await stop();return x is uint8;}globalThis.settled=\"pending\";f(uint8(1)).then(x=>{globalThis.settled=String(x);},e=>{globalThis.settled=\"rejected\";});\"scheduled\";")).toBe("rejected");
});

test("runtime: 10-caught-rejection", () => {
  expect(settledAfterJobs("async function stop():Promise.<never>{throw 0;}async function f(x:uint8|string){try{if(x is uint8)await stop();}catch(e){}return x is uint8;}globalThis.settled=\"pending\";f(uint8(1)).then(x=>{globalThis.settled=String(x);},e=>{globalThis.settled=\"rejected\";});\"scheduled\";")).toBe("true");
});

test("saved-inferred", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:=x is uint8;if(b){if(x is string){}}}");
});

test("saved-participating", () => {
  expectStaticTypeError("function f(x:uint8|string){const b=x is uint8;if(b){if(x is string){}}}");
});

test("saved-data-property", () => {
  expectStaticTypeError("class A{x:uint8|string=\"a\";}function f(a:A){const b:boolean=a.x is uint8;if(b){if(a.x is string){}}}");
});

test("saved-property-write", () => {
  evaluated("class A{x:uint8|string=\"a\";}function f(a:A,y:uint8|string){const b:boolean=a.x is uint8;a.x=y;if(b){if(a.x is string){}}}");
});

test("saved-property-alias", () => {
  evaluated("class A{x:uint8|string=\"a\";}function f(a:A,c:A,y:uint8|string){const b:boolean=a.x is uint8;c.x=y;if(b){if(a.x is string){}}}");
});

test("saved-varying-getter", () => {
  evaluated("function f(a:{readonly x:uint8|string}){const b:boolean=a.x is uint8;if(b){if(a.x is string){}}}");
});

test("stored-callable-contract", () => {
  expectStaticTypeError("const h:()=>void=()=>\"s\";function f(){return h()+\"x\";}");
});

test("stored-field-contract", () => {
  evaluated("function f(y:uint8|string){let x:{v:uint8|string}={v:uint8(1)};x.v=y;if(x.v is string){}}");
});

test("stored-ref-destination", () => {
  evaluated("function f(ref x:uint8|string,ref y:uint8|string){x=uint8(1);y=\"s\";if(x is string){}}");
});

test("excluded-value-query", () => {
  evaluated("function f(x:string){if(x===\"a\")return false;return x===\"a\";}");
});

test("generic-not-null-return", () => {
  evaluated("function f<T:type extends string|null>(x:T):T{if(x!==null)return x;return x;}");
});

test("generic-bound-query", () => {
  evaluated("function f<T:type extends boolean>(x:T){if(x)return x===false;return x;}");
});

test("generic-typeof-bound", () => {
  expectStaticTypeError("function f<T:type extends uint8|string>(x:T){if(typeof x===\"number\"){if(x is string){}}}");
});

test("generic-library-bound", () => {
  expectStaticTypeError("function f<T:type extends string|[].<uint8>>(x:T){if(x is string){}else{if(Array.isArray(x)){}}}");
});

test("numeric-pattern-after-store", () => {
  expectStaticTypeError("function f(){const x:1|2=1;return match(x){when 3:1;default:2;};}");
});

test("numeric-pattern-signed-values", () => {
  evaluated("function f(x:number){return match(x){when -0:1;when +0:2;default:3;};}");
});
