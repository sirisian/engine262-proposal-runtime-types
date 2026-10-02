import { expect, test } from 'vitest';
import { expectStaticTypeError, evaluated, settledAfterJobs } from '../harness.mts';

// #sec-narrowing-flow, #sec-narrowfrom, #sec-generator-types.

test("boolean-conversion: if", () => {
  expectStaticTypeError("function f(x:uint8|string){if(Boolean(x is uint8)){if(x is string){}}}");
});

test("boolean-conversion: known", () => {
  expectStaticTypeError("function f(x:object){if(Boolean(x)){}}");
});

test("boolean-conversion: while", () => {
  expectStaticTypeError("function f(x:uint8|string){while(Boolean(x is uint8)){if(x is string){}break;}}");
});

test("boolean-conversion: conditional", () => {
  expectStaticTypeError("function f(x:uint8|string){return Boolean(x is uint8) ? (x is string ? 1:2) : 0;}");
});

test("boolean-conversion: and", () => {
  expectStaticTypeError("function f(x:uint8|string){return Boolean(x is uint8) && (x is string ? 1:2);}");
});

test("boolean-conversion: direct", () => {
  expectStaticTypeError("function f(x:uint8|string){if(!!(x is uint8)){if(x is string){}}}");
});

test("boolean-conversion: shadowed", () => {
  evaluated("function f(x:uint8|string,Boolean:(boolean)=>boolean){if(Boolean(x is uint8)){if(x is string){}}}");
});

test("boolean-conversion: value", () => {
  evaluated("function f(x:object){return Boolean(x);}");
});

test("boolean-conversion: later-argument-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(Boolean(x is uint8,x=y)){if(x is string){}}}");
});

test("primitive-copy: if", () => {
  expectStaticTypeError("function f(x:uint8|string){const y:uint8|string=x;if(y is uint8){if(x is string){}}}");
});

test("primitive-copy: excluded-copy", () => {
  expectStaticTypeError("function f(x:string){if(x!==\"a\"){const y:string=x;if(y===\"a\"){}}}");
});

test("primitive-copy: reverse", () => {
  expectStaticTypeError("function f(x:uint8|string){const y:uint8|string=x;if(x is uint8){if(y is string){}}}");
});

test("primitive-copy: for", () => {
  expectStaticTypeError("function f(x:uint8|string){const y:uint8|string=x;for(;y is uint8;){if(x is string){}break;}}");
});

test("primitive-copy: label", () => {
  expectStaticTypeError("function f(x:uint8|string){const y:uint8|string=x;out:{if(y is string)break out;if(x is string){}}}");
});

test("primitive-copy: direct", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8){if(x is string){}}}");
});

test("primitive-copy: source-write", () => {
  evaluated("function f(x:uint8|string,z:uint8|string){const y:uint8|string=x;x=z;if(y is uint8){if(x is string){}}}");
});

test("primitive-copy: destination-write", () => {
  evaluated("function f(x:uint8|string,z:uint8|string){let y:uint8|string=x;y=z;if(y is uint8){if(x is string){}}}");
});

test("primitive-copy: unknown-join", () => {
  evaluated("function f(x:uint8|string,z:uint8|string,b:boolean){const y:uint8|string=b?x:z;if(y is uint8){if(x is string){}}}");
});

test("saved-typeof: if", () => {
  expectStaticTypeError("function f(x:uint8|string){const tag:string=typeof x;if(tag===\"string\"){if(x is uint8){}}}");
});

test("saved-typeof: switch", () => {
  expectStaticTypeError("function f(x:uint8|string){const tag:string=typeof x;switch(tag){case \"string\":if(x is uint8){}break;}}");
});

test("saved-typeof: or", () => {
  expectStaticTypeError("function f(x:uint8|string){const tag:string=typeof x;return tag!==\"string\" || (x is uint8 ? 1:2);}");
});

test("saved-typeof: try-finally", () => {
  expectStaticTypeError("function f(x:uint8|string){const tag:string=typeof x;try{if(tag===\"string\"){if(x is uint8){}}}finally{}}");
});

test("saved-typeof: inline", () => {
  expectStaticTypeError("function f(x:uint8|string){if(typeof x===\"string\"){if(x is uint8){}}}");
});

test("saved-typeof: source-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){const tag:string=typeof x;x=y;if(tag===\"string\"){if(x is uint8){}}}");
});

test("saved-typeof: same-tag", () => {
  evaluated("function f(x:uint8|uint16|string){const tag:string=typeof x;if(tag===\"number\"){return x is uint8;}}");
});

test("saved-typeof: mutable-tag", () => {
  evaluated("function f(x:uint8|string,t:string){let tag:string=typeof x;tag=t;if(tag===\"string\"){if(x is uint8){}}}");
});

test("ordered-members: if", () => {
  expectStaticTypeError("function f(x:1|2|3){if(x<2){if(x===3){}}}");
});

test("ordered-members: false", () => {
  expectStaticTypeError("function f(x:1|2|3){if(x<2){}else{if(x===1){}}}");
});

test("ordered-members: string", () => {
  expectStaticTypeError("function f(x:\"a\"|\"b\"|\"c\"){if(x<\"b\"){if(x===\"c\"){}}}");
});

test("ordered-members: while", () => {
  expectStaticTypeError("function f(x:1|2|3){while(x<2){if(x===3){}break;}}");
});

test("ordered-members: guard", () => {
  expectStaticTypeError("function f(x:1|2|3){return match(x){when _ if(x<2): x===3 ? 1:2;default:0;};}");
});

test("ordered-members: settled", () => {
  expectStaticTypeError("function f(x:1|2|3){if(x<1){}}");
});

test("ordered-members: two-survivors", () => {
  evaluated("function f(x:1|2|3){if(x<=2){if(x===1){}}}");
});

test("ordered-members: write", () => {
  evaluated("function f(x:1|2|3,y:1|2|3){if(x<2){x=y;if(x===3){}}}");
});

test("ordered-members: broad-domain", () => {
  evaluated("function f(x:uint8){if(x<100){if(x>=100){}}}");
});

test("numeric-categories: nan-finite", () => {
  expectStaticTypeError("function f(x:number){if(Number.isNaN(x)){if(Number.isFinite(x)){}}}");
});

test("numeric-categories: finite-nan", () => {
  expectStaticTypeError("function f(x:number){if(Number.isFinite(x)){if(Number.isNaN(x)){}}}");
});

test("numeric-categories: repeat", () => {
  expectStaticTypeError("function f(x:number){if(Number.isNaN(x)){if(Number.isNaN(x)){}}}");
});

test("numeric-categories: for-of", () => {
  evaluated("function f(x:number,ys:[].<uint8>){for(const y of ys){if(Number.isNaN(x)){if(Number.isFinite(x)){}}}}");
});

test("numeric-categories: do-while", () => {
  expectStaticTypeError("function f(x:number){do{if(Number.isNaN(x)){if(Number.isFinite(x)){}}}while(false);}");
});

test("numeric-categories: integer", () => {
  expectStaticTypeError("function f(x:uint8){if(Number.isNaN(x)){}}");
});

test("numeric-categories: not-finite-can-nan", () => {
  evaluated("function f(x:number){if(!Number.isFinite(x)){if(Number.isNaN(x)){}}}");
});

test("numeric-categories: write", () => {
  evaluated("function f(x:number,y:number){if(Number.isNaN(x)){x=y;if(Number.isFinite(x)){}}}");
});

test("numeric-categories: shadowed", () => {
  evaluated("function f(x:number,Number:{isNaN:(number)=>boolean,isFinite:(number)=>boolean}){if(Number.isNaN(x)){if(Number.isFinite(x)){}}}");
});

test("data-pattern: field", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";} function f(x:C){if(x is {tag:uint8}){if(x.tag is string){}}}");
});

test("data-pattern: literal", () => {
  expectStaticTypeError("class C{tag:string=\"\";} function f(x:C){if(x is {tag:\"a\"}){if(x.tag!==\"a\"){}}}");
});

test("data-pattern: composite", () => {
  expectStaticTypeError("function f(x:Composite.<{tag:uint8|string}>){if(x is {tag:uint8}){if(x.tag is string){}}}");
});

test("data-pattern: match", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";} function f(x:C){return match(x){when {tag:uint8}: x.tag is string ? 1:2;default:0;};}");
});

test("data-pattern: for-in", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";} function f(x:C,keys:object){for(const k in keys){if(x is {tag:uint8}){if(x.tag is string){}}}}");
});

test("data-pattern: direct", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";} function f(x:C){if(x.tag is uint8){if(x.tag is string){}}}");
});

test("data-pattern: getter", () => {
  evaluated("class C{get tag():uint8|string{return \"\";}} function f(x:C){if(x is {tag:uint8}){if(x.tag is string){}}}");
});

test("data-pattern: field-write", () => {
  evaluated("class C{tag:uint8|string=\"\";} function f(x:C,y:uint8|string){if(x is {tag:uint8}){x.tag=y;if(x.tag is string){}}}");
});

test("data-pattern: unknown-call", () => {
  evaluated("class C{tag:uint8|string=\"\";} function f(x:C,g:any){if(x is {tag:uint8}){g();if(x.tag is string){}}}");
});

test("constant-key: const", () => {
  expectStaticTypeError("class A{x:uint8=0;} function f(x:A){const key=\"x\";if(key in x){}}");
});

test("constant-key: singleton-key", () => {
  expectStaticTypeError("class A{x:uint8=0;} function f(x:A,key:\"x\"){if(key in x){}}");
});

test("constant-key: negative", () => {
  expectStaticTypeError("class A{x:uint8=0;} class B{y:uint8=0;} function f(x:A|B){const key=\"x\";if(!(key in x)){if(x is A){}}}");
});

test("constant-key: switch", () => {
  expectStaticTypeError("class A{x:uint8=0;} function f(x:A){const key=\"x\";switch(true){case key in x:break;}}");
});

test("constant-key: literal", () => {
  expectStaticTypeError("class A{x:uint8=0;} function f(x:A){if(\"x\" in x){}}");
});

test("constant-key: dynamic-key", () => {
  evaluated("class A{x:uint8=0;} function f(x:A,key:string){if(key in x){}}");
});

test("constant-key: key-union", () => {
  evaluated("class A{x:uint8=0;} function f(x:A,key:\"x\"|\"z\"){if(key in x){}}");
});

test("constant-key: structural", () => {
  evaluated("function f(x:{x:uint8}){const key=\"x\";if(key in x){}}");
});

test("constructor-origin: parenthesized", () => {
  expectStaticTypeError("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B){if(x instanceof (A)){if(x is B){}}}");
});

test("constructor-origin: same-class", () => {
  expectStaticTypeError("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A){if(x instanceof (A)){}}");
});

test("constructor-origin: alias", () => {
  expectStaticTypeError("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B){const C=A;if(x instanceof C){if(x is B){}}}");
});

test("constructor-origin: do-while", () => {
  expectStaticTypeError("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B){do{if(x instanceof (A)){if(x is B){}}}while(false);}");
});

test("constructor-origin: bare", () => {
  expectStaticTypeError("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B){if(x instanceof A){if(x is B){}}}");
});

test("constructor-origin: unknown-constructor", () => {
  evaluated("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B,C:any){if(x instanceof C){if(x is B){}}}");
});

test("constructor-origin: constructor-selection", () => {
  evaluated("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B,b:boolean){const C=b?A:B;if(x instanceof C){if(x is B){}}}");
});

test("constructor-origin: subject-write", () => {
  evaluated("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B,y:A|B){if(x instanceof (A)){x=y;if(x is B){}}}");
});

test("scalar-truthiness: truthy-string", () => {
  expectStaticTypeError("function f(x:string){if(x){if(x===\"\"){}}}");
});

test("scalar-truthiness: nonempty-string", () => {
  expectStaticTypeError("function f(x:string){if(x!==\"\"){if(!x){}}}");
});

test("scalar-truthiness: truthy-number", () => {
  expectStaticTypeError("function f(x:number){if(x){if(x===0){}}}");
});

test("scalar-truthiness: false-string", () => {
  expectStaticTypeError("function f(x:string){if(!x){if(x!==\"\"){}}}");
});

test("scalar-truthiness: for-await", () => {
  expectStaticTypeError("async function f(x:string,ys:[].<uint8>){for await(const y of ys){if(x){if(x===\"\"){}}}}");
});

test("scalar-truthiness: literal", () => {
  expectStaticTypeError("function f(x:\"a\"){if(!x){}}");
});

test("scalar-truthiness: nan", () => {
  evaluated("function f(x:number){if(x!==0){if(!x){}}}");
});

test("scalar-truthiness: null", () => {
  evaluated("function f(x:string|null){if(x!==\"\"){if(!x){}}}");
});

test("scalar-truthiness: write", () => {
  evaluated("function f(x:string,y:string){if(x){x=y;if(x===\"\"){}}}");
});

test("generator-result: yield-if", () => {
  expectStaticTypeError("function* f():Generator.<uint8,undefined,true>{if(yield uint8(1)){}}");
});

test("generator-result: yield-while", () => {
  expectStaticTypeError("function* f():Generator.<uint8,undefined,true>{while(yield uint8(1)){break;}}");
});

test("generator-result: yield-conditional", () => {
  expectStaticTypeError("function* f():Generator.<uint8,number,false>{return (yield uint8(1)) ? 1:2;}");
});

test("generator-result: yield-star", () => {
  expectStaticTypeError("function* g():Generator.<uint8,true,undefined>{yield uint8(1);return true;} function* f(p:number){if(yield* g()){}}");
});

test("generator-result: async-yield", () => {
  expectStaticTypeError("async function* f():AsyncGenerator.<uint8,undefined,true>{if(yield uint8(1)){}}");
});

test("generator-result: bound-result", () => {
  expectStaticTypeError("function* f():Generator.<uint8,undefined,true>{const b:true=yield uint8(1);if(b){}}");
});

test("generator-result: both-results", () => {
  evaluated("function* f():Generator.<uint8,undefined,boolean>{if(yield uint8(1)){}}");
});

test("generator-result: value", () => {
  evaluated("function* f():Generator.<uint8,true,true>{return yield uint8(1);}");
});

test("generator-result: catch", () => {
  evaluated("function* f():Generator.<uint8,undefined,true>{try{yield uint8(1);}catch(e:any){if(e){}}}");
});

test("numeric-categories: for", () => {
  expectStaticTypeError("function f(x:number,b:boolean){for(;b;){if(Number.isNaN(x)){if(Number.isFinite(x)){}}break;}}");
});

test("boolean-false", () => {
  expectStaticTypeError("function f(x:uint8|string){if(Boolean(x is uint8)){}else{if(x is uint8){}}}");
});

test("boolean-value-alias", () => {
  expectStaticTypeError("function f(x:uint8|string){const b:boolean=Boolean(x is uint8);if(b){if(x is string){}}}");
});

test("boolean-global-write", () => {
  evaluated("Boolean=(x)=>true;function f(x:uint8|string){if(Boolean(x is uint8)){if(x is string){}}}");
});

test("boolean-unknown-prior-call", () => {
  evaluated("function f(x:uint8|string,g:any){g();if(Boolean(x is uint8)){if(x is string){}}}");
});

test("boolean-new", () => {
  evaluated("function f(x:uint8|string){const b:any=new Boolean(x is uint8);if(b){if(x is string){}}}");
});

test("copy-chain", () => {
  expectStaticTypeError("function f(x:uint8|string){const a:uint8|string=x;const b:uint8|string=a;if(b is uint8){if(x is string){}}}");
});

test("copy-snapshot-keeps-exclusion", () => {
  expectStaticTypeError("function f(x:string,y:string){if(x!==\"a\"){const z:string=x;x=y;if(z===\"a\"){}}}");
});

test("copy-sibling-join", () => {
  evaluated("function f(x:uint8|string,b:boolean){const y:uint8|string=x;if(b){if(y is uint8)return;}if(x is string){}}");
});

test("copy-shadow", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){const a:uint8|string=x;{let x:uint8|string=y;if(a is uint8){if(x is string){}}}}");
});

test("copy-reference-call", () => {
  evaluated("function f(ref x:uint8|string,g:any){const y:uint8|string=x;g();if(y is uint8){if(x is string){}}}");
});

test("copy-loop-write", () => {
  evaluated("function f(x:uint8|string,z:uint8|string,b:boolean){const y:uint8|string=x;while(b){if(y is uint8){if(x is string){}}x=z;}}");
});

test("copy-untyped", () => {
  evaluated("function f(x:uint8|string){let y=x;if(y is uint8){if(x is string){}}}");
});

test("copy-closure-write", () => {
  evaluated("function f(x:uint8|string){const y:uint8|string=x;function change(){x=\"s\";}change();if(y is uint8){if(x is string){}}}");
});

test("copy-field", () => {
  expectStaticTypeError("class C{v:uint8|string=\"\";} function f(c:C){const y:uint8|string=c.v;if(y is uint8){if(c.v is string){}}}");
});

test("copy-field-call", () => {
  evaluated("class C{v:uint8|string=\"\";} function f(c:C,g:any){const y:uint8|string=c.v;g();if(y is uint8){if(c.v is string){}}}");
});

test("tag-number-collision", () => {
  expectStaticTypeError("function f(x:uint8|uint16|string){const t:string=typeof x;if(t===\"number\"){if(x is string){}}}");
});

test("tag-null-retained", () => {
  evaluated("function f(x:object|null|string){const t:string=typeof x;if(t===\"object\"){if(x is null){}}}");
});

test("tag-switch-fallthrough", () => {
  evaluated("function f(x:uint8|string,b:boolean){const t:string=typeof x;switch(t){case \"number\":if(b)break;case \"string\":if(x is uint8){}break;}}");
});

test("tag-unknown-call-reference", () => {
  evaluated("function f(ref x:uint8|string,g:any){const t:string=typeof x;g();if(t===\"string\"){if(x is uint8){}}}");
});

test("ordered-mirrored", () => {
  expectStaticTypeError("function f(x:1|2|3){if(2>x){if(x===3){}}}");
});

test("ordered-false-string", () => {
  expectStaticTypeError("function f(x:\"a\"|\"b\"|\"c\"){if(x<\"b\")return;if(x===\"a\"){}}");
});

test("ordered-value-only", () => {
  evaluated("function f(x:1|2|3){if(x<2)return x===3;return false;}");
});

test("category-negative", () => {
  expectStaticTypeError("function f(x:number){if(!Number.isNaN(x)){if(Number.isNaN(x)){}}}");
});

test("category-join", () => {
  evaluated("function f(x:number,b:boolean){if(b){if(Number.isNaN(x))return;}if(Number.isNaN(x)){}}");
});

test("category-both-edges", () => {
  expectStaticTypeError("function f(x:number,b:boolean){if(b){if(!Number.isFinite(x))return;}else{if(!Number.isFinite(x))return;}if(Number.isNaN(x)){}}");
});

test("category-alias", () => {
  expectStaticTypeError("function f(x:number){const y:number=x;if(Number.isNaN(y)){if(Number.isFinite(x)){}}}");
});

test("category-unknown-call", () => {
  evaluated("function f(ref x:number,g:any){if(Number.isNaN(x)){g();if(Number.isFinite(x)){}}}");
});

test("category-global-write", () => {
  evaluated("Number.isFinite=(x)=>true;function f(x:number){if(Number.isNaN(x)){if(Number.isFinite(x)){}}}");
});

test("pattern-explicit-member", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";} function f(x:C){if(x is {tag:let v:uint8}){if(x.tag is string){}}}");
});

test("pattern-nested", () => {
  expectStaticTypeError("class D{tag:uint8|string=\"\";}class C{inner:D=new D();}function f(x:C){if(x is {inner:{tag:uint8}}){if(x.inner.tag is string){}}}");
});

test("pattern-failure-ambiguous", () => {
  evaluated("class C{a:uint8|string=\"\";b:uint8|string=\"\";}function f(x:C){if(x is {a:uint8,b:uint8}){}else{if(x.a is uint8){}}}");
});

test("pattern-later-getter", () => {
  evaluated("class C{a:uint8|string=\"\";get b():uint8|string{return \"\";}}function f(x:C){if(x is {a:uint8,b:uint8}){if(x.a is string){}}}");
});

test("pattern-prefix-write", () => {
  evaluated("class D{tag:uint8|string=\"\";}class C{inner:D=new D();}function f(x:C,y:D){if(x is {inner:{tag:uint8}}){x.inner=y;if(x.inner.tag is string){}}}");
});

test("pattern-or", () => {
  evaluated("class C{tag:uint8|string=\"\";}function f(x:C){if(x is {tag:uint8} or {tag:string}){if(x.tag is string){}}}");
});

test("key-shadow", () => {
  evaluated("class A{x:uint8=0;}function f(x:A,k:string){const key=\"x\";{let key:string=k;if(key in x){}}}");
});

test("key-singleton-alias", () => {
  expectStaticTypeError("class A{x:uint8=0;}function f(x:A){const key:\"x\"=\"x\";if(key in x){}}");
});

test("key-value-query", () => {
  evaluated("class A{x:uint8=0;}function f(x:A){const key=\"x\";return key in x;}");
});

test("constructor-alias-chain", () => {
  expectStaticTypeError("class A{a:uint8=0;}class B{b:uint8=0;}function f(x:A|B){const C=A;const D=C;if(x instanceof D){if(x is B){}}}");
});

test("constructor-shadow", () => {
  evaluated("class A{a:uint8=0;}class B{b:uint8=0;}function f(x:A|B,C:any){const D=A;{const D=C;if(x instanceof D){if(x is B){}}}}");
});

test("constructor-custom-hook", () => {
  evaluated("class A{a:uint8=0;static [Symbol.hasInstance](x:any):boolean{return true;}}class B{b:uint8=0;}function f(x:A|B){if(x instanceof (A)){if(x is B){}}}");
});

test("constructor-hook-replaced", () => {
  evaluated("class A{a:uint8=0;}class B{b:uint8=0;}Object.defineProperty(A,Symbol.hasInstance,{value:()=>true});function f(x:A|B){const C=A;if(x instanceof C){if(x is B){}}}");
});

test("truthy-number-nan", () => {
  expectStaticTypeError("function f(x:number){if(x){if(Number.isNaN(x)){}}}");
});

test("truthy-uint8", () => {
  expectStaticTypeError("function f(x:uint8){if(x){if(x===0){}}}");
});

test("truthy-bigint", () => {
  expectStaticTypeError("function f(x:bigint){if(x){if(x===0n){}}}");
});

test("falsy-string", () => {
  expectStaticTypeError("function f(x:string){if(!x){if(x===\"a\"){}}}");
});

test("truthy-join", () => {
  evaluated("function f(x:string,b:boolean){if(b){if(!x)return;}if(x===\"\"){}}");
});

test("truthy-snapshot", () => {
  expectStaticTypeError("function f(x:string){const y:string=x;if(y){if(x===\"\"){}}}");
});

test("truthy-getter", () => {
  evaluated("class C{get v():string{return \"\";}}function f(c:C){if(c.v){if(c.v===\"\"){}}}");
});

test("yield-captured-reference", () => {
  evaluated("function* f(ref x:uint8|string):Generator.<uint8,undefined,boolean>{const b:boolean=x is uint8;yield uint8(1);if(b){if(x is string){}}}");
});

test("yield-direct-false", () => {
  expectStaticTypeError("function* f():Generator.<uint8,undefined,false>{if(yield uint8(1)){}}");
});

test("yield-delegate-boolean", () => {
  evaluated("function* g(b:boolean):Generator.<uint8,boolean,undefined>{yield uint8(1);return b;}function* f(b:boolean){if(yield* g(b)){}}");
});

test("constructor-unknown-call", () => {
  evaluated("class A{a:uint8=0;}class B{b:uint8=0;}function f(x:A|B,g:any){g();if(x instanceof (A)){if(x is B){}}}");
});

test("ordered-getter", () => {
  evaluated("class C{get value():1|2|3{return 1;}}function f(c:C){if(c.value<2){if(c.value===3){}}}");
});

test("truthy-number-replaced", () => {
  evaluated("function f(x:number,y:number){if(x){x=y;if(x===0){}}}");
});

test("runtime: 01-original", () => {
  expect(evaluated("function f(x:uint8|string){return String(Boolean(x is uint8))+\",\"+String(x is string);} f(uint8(1));")).toBe("true,false");
});

test("runtime: 01-later-effect", () => {
  expect(evaluated("function f(x:uint8|string){return String(Boolean(x is uint8,x=\"s\"))+\",\"+String(x is string);} f(uint8(1));")).toBe("true,true");
});

test("runtime: 01-shadowed", () => {
  expect(evaluated("function f(x:uint8|string,Boolean:(boolean)=>boolean){return String(Boolean(x is uint8))+\",\"+String(x is string);} f(\"s\",(b:boolean):boolean=>!b);")).toBe("true,true");
});

test("runtime: 02-copy", () => {
  expect(evaluated("function f(x:uint8|string){const y:uint8|string=x;return String(y is uint8)+\",\"+String(x is string);} f(uint8(1));")).toBe("true,false");
});

test("runtime: 02-replacement", () => {
  expect(evaluated("function f(x:uint8|string){const y:uint8|string=x;x=\"s\";return String(y is uint8)+\",\"+String(x is string);} f(uint8(1));")).toBe("true,true");
});

test("runtime: 03-tag", () => {
  expect(evaluated("function f(x:uint8|string){const tag:string=typeof x;return tag+\",\"+String(x is uint8);} f(\"s\");")).toBe("string,false");
});

test("runtime: 03-replacement", () => {
  expect(evaluated("function f(x:uint8|string){const tag:string=typeof x;x=uint8(1);return tag+\",\"+String(x is uint8);} f(\"s\");")).toBe("string,true");
});

test("runtime: 04-order", () => {
  expect(evaluated("function f(x:1|2|3){if(x<2)return String(x===3);return \"outside\";} f(1);")).toBe("false");
});

test("runtime: 04-string-order", () => {
  expect(evaluated("function f(x:\"a\"|\"b\"|\"c\"){if(x<\"b\")return String(x===\"c\");return \"outside\";} f(\"a\");")).toBe("false");
});

test("runtime: 04-live", () => {
  expect(evaluated("function f(x:1|2|3){if(x<=2)return String(x===1);return \"outside\";} f(1)+\",\"+f(2);")).toBe("true,false");
});

test("runtime: 05-nan", () => {
  expect(evaluated("function f(x:number){if(Number.isNaN(x))return String(Number.isFinite(x));return \"outside\";} f(NaN);")).toBe("false");
});

test("runtime: 05-false-finite", () => {
  expect(evaluated("function f(x:number){if(!Number.isFinite(x))return String(Number.isNaN(x));return \"outside\";} f(NaN)+\",\"+f(Infinity);")).toBe("true,false");
});

test("runtime: 06-data-field", () => {
  expect(evaluated("class C{tag:uint8|string=uint8(1);} function f(x:C){if(x is {tag:uint8})return String(x.tag is string);return \"outside\";} f(new C());")).toBe("false");
});

test("runtime: 06-getter", () => {
  expect(evaluated("class C{index:number=0;get tag():uint8|string{this.index++;return this.index===1 ? uint8(1):\"s\";}} function f(x:C){if(x is {tag:uint8})return String(x.tag is string);return \"outside\";} f(new C());")).toBe("true");
});

test("runtime: 07-key", () => {
  expect(evaluated("class A{x:uint8=0;} function f(x:A){const key=\"x\";return String(key in x);} f(new A());")).toBe("true");
});

test("runtime: 07-dynamic", () => {
  expect(evaluated("class A{x:uint8=0;} function f(x:A,key:string){return String(key in x);} f(new A(),\"x\")+\",\"+f(new A(),\"z\");")).toBe("true,false");
});

test("runtime: 08-parentheses", () => {
  expect(evaluated("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B){return String(x instanceof (A))+\",\"+String(x is B);} f(new A());")).toBe("true,false");
});

test("runtime: 08-selected-constructor", () => {
  expect(evaluated("class A{a:uint8=0;} class B{b:uint8=0;} function f(x:A|B,b:boolean){const C=b?A:B;return String(x instanceof C)+\",\"+String(x is B);} f(new B(),false);")).toBe("true,true");
});

test("runtime: 09-truthy", () => {
  expect(evaluated("function f(x:string){if(x)return String(x===\"\");return \"outside\";} f(\"a\");")).toBe("false");
});

test("runtime: 09-nan", () => {
  expect(evaluated("function f(x:number){if(x!==0)return String(!x);return \"outside\";} f(NaN)+\",\"+f(1);")).toBe("true,false");
});

test("runtime: 10-yield-next", () => {
  expect(evaluated("function* f():Generator.<uint8,string,true>{return String(yield uint8(1));} const g=f();g.next();String(g.next(true).value);")).toBe("true");
});

test("runtime: 10-delegation", () => {
  expect(evaluated("function* a():Generator.<uint8,true,undefined>{yield uint8(1);return true;} function* b():Generator.<uint8,string,undefined>{return String(yield* a());} const g=b();g.next();String(g.next().value);")).toBe("true");
});

test("runtime: 10-boolean-next", () => {
  expect(evaluated("function* f():Generator.<uint8,string,boolean>{return String(yield uint8(1));} const a=f();a.next();const b=f();b.next();String(a.next(true).value)+\",\"+String(b.next(false).value);")).toBe("true,false");
});

test("runtime: 10-thrown-resumption", () => {
  expect(evaluated("function* f():Generator.<uint8,string,true>{try{yield uint8(1);}catch(e:any){return \"caught\";}return \"normal\";} const g=f();g.next();String(g.throw(\"x\").value);")).toBe("caught");
});

test("runtime: 10-async-resume", () => {
  expect(settledAfterJobs("globalThis.settled=\"unset\"; async function* f():AsyncGenerator.<uint8,string,true>{return String(yield uint8(1));} const g=f();g.next().then(()=>{g.next(true).then(r=>{globalThis.settled=r.value;});});")).toBe("true");
});

test("runtime: numeric-iterator-replaces-intrinsic", () => {
  expect(evaluated("let ys:[].<uint8>=[];ys[Symbol.iterator]=function*(){Number.isFinite=()=>true;yield uint8(1);};function f(x:number,ys:[].<uint8>){for(const y of ys){if(Number.isNaN(x)){return String(Number.isFinite(x));}}return \"outside\";}f(NaN,ys);")).toBe("true");
});

test("category: unknown logical-not effect", () => {
  evaluated("function f(x:number,c:any){!c;if(Number.isNaN(x)){if(Number.isFinite(x)){}}}");
});

test("constructor: negated grouped origin", () => {
  expectStaticTypeError("class A{a:uint8=0;}class B{b:uint8=0;}function f(x:A|B){if(!(x instanceof (A))){if(x is A){}}}");
});
