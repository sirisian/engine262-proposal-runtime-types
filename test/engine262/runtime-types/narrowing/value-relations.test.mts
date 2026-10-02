import { expect, test } from 'vitest';
import { expectStaticTypeError, evaluated } from '../harness.mts';

// #sec-narrowing-flow, #sec-narrowfrom, #sec-proved-library-operations.

test("short circuit: if", () => {
  expectStaticTypeError("function f(x:string){if(x!==\"\"){x||0;}}");
});

test("short circuit: truthy-edge", () => {
  expectStaticTypeError("function f(x:string){if(x){x||0;}}");
});

test("short circuit: nan", () => {
  expectStaticTypeError("function f(x:number){if(Number.isNaN(x)){x&&0;}}");
});

test("short circuit: do", () => {
  expectStaticTypeError("function f(x:string){do{if(x!==\"\"){x||0;}return;}while(false);}");
});

test("short circuit: conditional", () => {
  expectStaticTypeError("function f(x:string){return x!==\"\"?(x||0):1;}");
});

test("NaN self comparison: nan-equality", () => {
  expectStaticTypeError("function f(x:number){if(Number.isNaN(x)){if(x===x){}}}");
});

test("NaN self comparison: notnan-inequality", () => {
  expectStaticTypeError("function f(x:number){if(!Number.isNaN(x)){if(x!==x){}}}");
});

test("NaN self comparison: self-predicate", () => {
  expectStaticTypeError("function f(x:number){if(x!==x){if(Number.isNaN(x)){}}}");
});

test("NaN self comparison: and", () => {
  expectStaticTypeError("function f(x:number){if(x!==x && Number.isFinite(x)){}}");
});

test("NaN self comparison: switch", () => {
  expectStaticTypeError("function f(x:number){switch(Number.isNaN(x)){case true:if(x===x){}break;default:break;}}");
});

test("numeric categories: integer-finite", () => {
  expectStaticTypeError("function f(x:number){if(Number.isInteger(x)){if(Number.isFinite(x)){}}}");
});

test("numeric categories: safe-integer", () => {
  expectStaticTypeError("function f(x:number){if(Number.isSafeInteger(x)){if(Number.isInteger(x)){}}}");
});

test("numeric categories: negative", () => {
  expectStaticTypeError("function f(x:number){if(!Number.isInteger(x)){if(Number.isSafeInteger(x)){}}}");
});

test("numeric categories: nan", () => {
  expectStaticTypeError("function f(x:number){if(Number.isNaN(x)){if(Number.isInteger(x)){}}}");
});

test("numeric categories: for", () => {
  expectStaticTypeError("function f(x:number,b:boolean){for(;b;){if(Number.isSafeInteger(x)){if(Number.isFinite(x)){}}break;}}");
});

test("typeof pairs: if", () => {
  expectStaticTypeError("function f(x:uint8|string,y:string|boolean){if(typeof x===typeof y){if(x is uint8){}}}");
});

test("typeof pairs: negative", () => {
  expectStaticTypeError("function f(x:uint8|string,y:string){if(typeof x!==typeof y){if(x is string){}}}");
});

test("typeof pairs: numeric-tags", () => {
  expectStaticTypeError("function f(x:uint8|uint16|string,y:string|boolean){if(typeof x===typeof y){if(x is uint8){}}}");
});

test("typeof pairs: switch", () => {
  expectStaticTypeError("function f(x:uint8|string,y:string|boolean){switch(typeof x){case typeof y:if(x is uint8){}break;default:break;}}");
});

test("typeof pairs: for-in", () => {
  expectStaticTypeError("function f(x:uint8|string,y:string|boolean,o:object){for(const k in o){if(typeof x===typeof y){if(y is boolean){}}}}");
});

test("equality relations: if", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8|string){if(x===y){if(x is uint8){if(y is string){}}}}");
});

test("equality relations: exclusion", () => {
  expectStaticTypeError("function f(x:string,y:string){if(x===y){if(x!==\"a\"){if(y===\"a\"){}}}}");
});

test("equality relations: while", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8|string){while(x===y){if(x is uint8){if(y is string){}}break;}}");
});

test("equality relations: for-of", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8|string,items:[].<uint8>){for(const item of items){if(x===y){if(x is uint8){if(y is string){}}}}}");
});

test("equality relations: for-await", () => {
  expectStaticTypeError("async function f(x:uint8|string,y:uint8|string,items:AsyncGenerator.<uint8,void,void>){for await(const item of items){if(x===y){if(x is uint8){if(y is string){}}}}}");
});

test("equality relations: match-guard", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8|string,b:boolean){return match(b){when true if(x===y):do{if(x is uint8){if(y is string){}}0;};default:0;};}");
});

test("SameValue: string", () => {
  expectStaticTypeError("function f(x:uint8|string){if(Object.is(x,\"a\")){if(x is uint8){}}}");
});

test("SameValue: negative", () => {
  expectStaticTypeError("function f(x:string){if(!Object.is(x,\"a\")){if(x===\"a\"){}}}");
});

test("SameValue: nan", () => {
  expectStaticTypeError("function f(x:number){if(Object.is(x,NaN)){if(Number.isFinite(x)){}}}");
});

test("SameValue: zero", () => {
  expectStaticTypeError("function f(x:number){if(Object.is(x,-0)){if(x!==0){}}}");
});

test("SameValue: switch", () => {
  expectStaticTypeError("function f(x:uint8|string){switch(Object.is(x,\"a\")){case true:if(x is uint8){}break;default:break;}}");
});

test("assignment results: truthy", () => {
  expectStaticTypeError("function f(x:string,y:string){if(x=y){if(y===\"\"){}}}");
});

test("assignment results: falsy", () => {
  expectStaticTypeError("function f(x:string,y:string){if(x=y){}else{if(y!==\"\"){}}}");
});

test("assignment results: conditional", () => {
  expectStaticTypeError("function f(x:string,y:string){return (x=y)?(y===\"\"?1:2):0;}");
});

test("assignment results: nullable", () => {
  expectStaticTypeError("function f(x:string|null,y:string|null){if(x=y){if(y===null){}}}");
});

test("assignment results: object-result", () => {
  expectStaticTypeError("class C{}function f(x:C,y:C){if(x=y){}}");
});

test("assignment results: catch", () => {
  expectStaticTypeError("function f(x:string,y:string){try{throw 1;}catch{if(x=y){if(y===\"\"){}}}}");
});

test("operator results: binary", () => {
  expectStaticTypeError("class C{operator+(x:uint8):true{return true;}}function f(c:C){if(c+uint8(1)){}}");
});

test("operator results: unary", () => {
  expectStaticTypeError("class C{operator+():true{return true;}}function f(c:C){if(+c){}}");
});

test("operator results: compound", () => {
  expectStaticTypeError("class C{operator+=(x:uint8):true{return true;}}function f(c:C){if(c+=uint8(1)){}}");
});

test("operator results: while", () => {
  expectStaticTypeError("class C{operator+(x:uint8):false{return false;}}function f(c:C){while(c+uint8(1)){break;}}");
});

test("operator results: narrowed", () => {
  expectStaticTypeError("class C{operator+(x:uint8):true{return true;}}function f(c:C|null){if(c!==null){if(c+uint8(1)){}}}");
});

test("data destructuring: copy", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";}function f(x:C){const {tag}=x;if(tag is uint8){if(x.tag is string){}}}");
});

test("data destructuring: rename", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";}function f(x:C){const {tag:y}=x;if(y is uint8){if(x.tag is string){}}}");
});

test("data destructuring: incoming-type", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";}function f(x:C){if(x.tag is uint8){const {tag}=x;if(tag is string){}}}");
});

test("data destructuring: incoming-exclusion", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";}function f(x:C){if(x.tag!==\"\"){const {tag}=x;if(tag===\"\"){}}}");
});

test("data destructuring: label", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";}function f(x:C){out:{const {tag}=x;if(tag is string)break out;if(x.tag is string){}}}");
});

test("object results: match-all", () => {
  expectStaticTypeError("function f(x:uint8|string){if(match all(x){when uint8:0;}){}}");
});

test("object results: match-all-while", () => {
  expectStaticTypeError("function f(x:uint8|string){while(match all(x){when uint8:0;}){break;}}");
});

test("object results: generator", () => {
  expectStaticTypeError("function f(){if(do * {yield 1;}){}}");
});

test("object results: async-generator", () => {
  expectStaticTypeError("function f(){if(async do * {yield 1;}){}}");
});

test("object results: try-finally", () => {
  expectStaticTypeError("function f(x:uint8|string){try{return (match all(x){when uint8:0;})?1:2;}finally{}}");
});

test("short circuit: control", () => {
  expectStaticTypeError("function f(x:string){if(x!==\"\"){if(x){}}}");
});

test("NaN self comparison: control", () => {
  expectStaticTypeError("function f(x:uint8){if(x!==x){}}");
});

test("numeric categories: control", () => {
  expectStaticTypeError("function f(x:number){if(Number.isNaN(x)){if(Number.isFinite(x)){}}}");
});

test("typeof pairs: control", () => {
  expectStaticTypeError("function f(x:uint8|string){if(typeof x===\"string\"){if(x is uint8){}}}");
});

test("equality relations: control", () => {
  expectStaticTypeError("function f(x:uint8|string){const y:uint8|string=x;if(y is uint8){if(x is string){}}}");
});

test("SameValue: control", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x===\"a\"){if(x is uint8){}}}");
});

test("assignment results: control", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(b=(x is uint8)){if(x is string){}}}");
});

test("operator results: control", () => {
  expectStaticTypeError("function yes():true{return true;}function f(p:number){if(yes()){}}");
});

test("data destructuring: control", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";}function f(x:C){if(x is {tag:uint8}){if(x.tag is string){}}}");
});

test("object results: control", () => {
  expectStaticTypeError("function f(x:uint8|string){return (match all(x){when uint8:0;})||0;}");
});

test("short circuit: live-write", () => {
  evaluated("function f(x:string,y:string){if(x!==\"\"){x=y;x||0;}}");
});

test("short circuit: live-numeric-nan", () => {
  evaluated("function f(x:number){if(x!==0){x||0;}}");
});

test("short circuit: live-join", () => {
  evaluated("function f(x:string,b:boolean){if(b){if(x===\"\")return;}x||0;}");
});

test("NaN self comparison: live-unclassified", () => {
  evaluated("function f(x:number){if(x!==x){}}");
});

test("NaN self comparison: live-write", () => {
  evaluated("function f(x:number,y:number){if(Number.isNaN(x)){x=y;if(x===x){}}}");
});

test("NaN self comparison: live-getter", () => {
  evaluated("function f(o:{x:number}){if(o.x!==o.x){}}");
});

test("numeric categories: live-fraction", () => {
  evaluated("function f(x:number){if(Number.isFinite(x)){if(Number.isInteger(x)){}}}");
});

test("numeric categories: live-unsafe-integer", () => {
  evaluated("function f(x:number){if(Number.isInteger(x)){if(Number.isSafeInteger(x)){}}}");
});

test("numeric categories: live-shadow", () => {
  evaluated("function f(Number:any,x:number){if(Number.isInteger(x)){if(Number.isFinite(x)){}}}");
});

test("typeof pairs: live-collision", () => {
  evaluated("function f(x:uint8|uint16|string,y:uint8|string){if(typeof x===typeof y){if(x is uint8){}}}");
});

test("typeof pairs: live-both-open-negative", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(typeof x!==typeof y){if(x is string){}}}");
});

test("typeof pairs: live-write", () => {
  evaluated("function f(x:uint8|string,y:string|boolean,z:uint8|string){if(typeof x===typeof y){x=z;if(x is uint8){}}}");
});

test("equality relations: live-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string,z:uint8|string){if(x===y){y=z;if(x is uint8){if(y is string){}}}}");
});

test("equality relations: live-join", () => {
  evaluated("function f(x:uint8|string,y:uint8|string,b:boolean){if(b){if(x!==y)return;}if(x is uint8){if(y is string){}}}");
});

test("equality relations: live-zero-sign", () => {
  evaluated("function f(x:number,y:number){if(x===y){if(Object.is(x,-0)){if(Object.is(y,0)){}}}}");
});

test("SameValue: live-zero-miss", () => {
  evaluated("function f(x:number){if(!Object.is(x,-0)){if(x===0){}}}");
});

test("SameValue: live-shadow", () => {
  evaluated("function f(Object:any,x:uint8|string){if(Object.is(x,\"a\")){if(x is uint8){}}}");
});

test("SameValue: live-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(Object.is(x,\"a\")){x=y;if(x is uint8){}}}");
});

test("assignment results: live-both-values", () => {
  evaluated("function f(x:string,y:string){if(x=y){}}");
});

test("assignment results: live-write", () => {
  evaluated("function f(x:string,y:string,z:string){if(x=y){y=z;if(y===\"\"){}}}");
});

test("assignment results: live-setter", () => {
  evaluated("function f(y:string){const box:{x:string}={get x(){return \"old\";},set x(v:string){y=\"\";}};if(box.x=y){if(y===\"\"){}}}");
});

test("operator results: live-both-results", () => {
  evaluated("class C{operator+(x:uint8):boolean{return true;}}function f(c:C){if(c+uint8(1)){}}");
});

test("operator results: live-value-query", () => {
  evaluated("class C{operator+(x:uint8):true{return true;}}function f(c:C){return c+uint8(1);}");
});

test("operator results: live-body-inference", () => {
  evaluated("class C{operator+(x:uint8){return true;}}function f(c:C){if(c+uint8(1)){}}");
});

test("data destructuring: live-later-getter", () => {
  evaluated("class C{tag:uint8|string=\"\";get other(){this.tag=\"changed\";return 0;}}function f(x:C){const {tag,other}=x;if(tag is uint8){if(x.tag is string){}}}");
});

test("data destructuring: live-write", () => {
  evaluated("class C{tag:uint8|string=\"\";}function f(x:C,y:uint8|string){const {tag}=x;x.tag=y;if(tag is uint8){if(x.tag is string){}}}");
});

test("data destructuring: live-getter-source", () => {
  evaluated("function f(x:{tag:uint8|string}){const {tag}=x;if(tag is uint8){if(x.tag is string){}}}");
});

test("object results: live-collection-query", () => {
  evaluated("function f(x:uint8|string){return match all(x){when uint8:0;};}");
});

test("object results: live-ordinary-match", () => {
  evaluated("function f(x:uint8|string){if(match(x){when uint8:1;default:0;}){}}");
});

test("object results: live-ordinary-do", () => {
  evaluated("function f(b:boolean){if(do{b;}){}}");
});

test("relation chain", () => {
  expectStaticTypeError("function f(a:uint8|string,b:uint8|string,c:uint8|string){if(a===b){if(b===c){if(a is uint8){if(c is string){}}}}}");
});

test("relation reverse", () => {
  expectStaticTypeError("function f(a:string,b:string){if(a===b){if(b!==\"a\"){if(a===\"a\"){}}}}");
});

test("relation unequal", () => {
  evaluated("function f(a:uint8|string,b:uint8|string){if(a!==b){if(a is uint8){if(b is string){}}}}");
});

test("relation property alias", () => {
  evaluated("class C{tag:uint8|string=\"\";}function f(a:C,b:C,g:any){if(a.tag===b.tag){g();if(a.tag is uint8){if(b.tag is string){}}}}");
});

test("relation shadow", () => {
  evaluated("function f(a:uint8|string,b:uint8|string,c:uint8|string){if(a===b){if(a is uint8){let b:uint8|string=c;if(b is string){}}}}");
});

test("relation zero negative", () => {
  evaluated("function f(a:number,b:number){if(a===b){if(!Object.is(a,-0)){if(Object.is(b,-0)){}}}}");
});

test("relation zero positive", () => {
  evaluated("function f(a:number,b:number){if(a===b){if(Object.is(a,-0)){if(Object.is(b,0)){}}}}");
});

test("same value pair", () => {
  expectStaticTypeError("function f(a:uint8|string,b:string|boolean){if(Object.is(a,b)){if(a is uint8){}}}");
});

test("same value negative sign", () => {
  expectStaticTypeError("function f(x:0|-0){if(!Object.is(x,-0)){if(x===0){}}}");
});

test("same value replaced", () => {
  evaluated("Object.is=function(a,b){return true;};function f(x:uint8|string){if(Object.is(x,\"a\")){if(x is uint8){}}}");
});

test("same value unknown call", () => {
  evaluated("function f(x:uint8|string,g:any){g();if(Object.is(x,\"a\")){if(x is uint8){}}}");
});

test("same value numeric identity", () => {
  expectStaticTypeError("function f(x:uint8|number){if(Object.is(x,1)){if(x is uint8){}}}");
});

test("predicate float", () => {
  expectStaticTypeError("function f(x:float32){if(Number.isSafeInteger(x)){if(Number.isInteger(x)){}}}");
});

test("predicate union", () => {
  expectStaticTypeError("function f(x:number|float32){if(Number.isInteger(x)){if(Number.isFinite(x)){}}}");
});

test("predicate join", () => {
  evaluated("function f(x:number,b:boolean){if(b){if(!Number.isSafeInteger(x))return;}if(Number.isInteger(x)){}}");
});

test("self float", () => {
  expectStaticTypeError("function f(x:float32){if(x!==x){if(Number.isNaN(x)){}}}");
});

test("typeof inequality two open", () => {
  evaluated("function f(x:uint8|string,y:string|boolean){if(typeof x!==typeof y){if(x is string){}}}");
});

test("typeof null collision", () => {
  evaluated("function f(x:null|{a:uint8},y:{b:uint8}){if(typeof x===typeof y){if(x is null){}}}");
});

test("assignment logical and", () => {
  expectStaticTypeError("function f(a:string,b:string){if(a&&=b){if(b===\"\"){}}}");
});

test("assignment logical or", () => {
  evaluated("function f(a:string,b:string){if(a||=b){if(b===\"\"){}}}");
});

test("assignment skip false", () => {
  expectStaticTypeError("function f(a:string,b:string){if(a||=b){}else{if(b!==\"\"){}}}");
});

test("operator not singleton", () => {
  expectStaticTypeError("class C{operator!():true{return true;}}function f(c:C){if(!c){}}");
});

test("operator not broad", () => {
  evaluated("class C{operator!():boolean{return true;}}function f(c:C){if(!c){}}");
});

test("operator derived true", () => {
  expectStaticTypeError("class C{operator<(c:C):true{return true;}}function f(a:C,b:C){if(a>=b){}}");
});

test("operator derived false", () => {
  expectStaticTypeError("class C{operator<(c:C):false{return false;}}function f(a:C,b:C){if(a>b){}}");
});

test("operator derived query", () => {
  evaluated("class C{operator<(c:C):true{return true;}}function f(a:C,b:C){const result:boolean=a>=b;}");
});

test("destructure nested", () => {
  expectStaticTypeError("class I{tag:uint8|string=\"\";}class O{inner:I=new I();}function f(x:O){const {inner:{tag}}=x;if(tag is uint8){if(x.inner.tag is string){}}}");
});

test("destructure computed effect", () => {
  evaluated("class C{tag:uint8|string=\"\";other:string=\"\";}function f(x:C,g:any){const {tag,[g()]:other}=x;if(tag is uint8){if(x.tag is string){}}}");
});

test("destructure default effect", () => {
  evaluated("class C{tag:uint8|string=\"\";other:string|undefined=undefined;}function f(x:C,g:any){const {tag,other=g()}=x;if(tag is uint8){if(x.tag is string){}}}");
});

test("destructure rest effect", () => {
  evaluated("class C{tag:uint8|string=\"\";}function f(x:C){const {tag,...rest}=x;if(tag is uint8){if(x.tag is string){}}}");
});

test("destructure snapshot", () => {
  expectStaticTypeError("class C{tag:uint8|string=\"\";get other():string{this.tag=\"s\";return \"\";}}function f(x:C){if(x.tag is uint8){const {tag,other}=x;if(tag is string){}}}");
});

test("destructure array conservative", () => {
  evaluated("function f(xs:[].<uint8|string>){const [tag]=xs;if(tag is uint8){if(xs[0] is string){}}}");
});

test("short circuit selected and", () => {
  evaluated("function f(x:string){if(x!==\"\"){x&&0;}}");
});

test("short circuit selected or", () => {
  evaluated("function f(x:string){if(x===\"\"){x||0;}}");
});

test("switch label effect", () => {
  evaluated("function f(x:number,g:any){switch(Number.isNaN(x)){case g():break;case true:if(Number.isFinite(x)){}break;}}");
});

test("switch fallthrough", () => {
  evaluated("function f(x:number){switch(Number.isNaN(x)){case false:case true:if(Number.isFinite(x)){}break;}}");
});

test("operator equality negated", () => {
  expectStaticTypeError("class C{operator==(c:C):true{return true;}}function f(a:C,b:C){if(a!=b){}}");
});

test("operator equality object", () => {
  expectStaticTypeError("class C{operator==(c:C):object{return {};}}function f(a:C,b:C){if(a==b){}}");
});

test("operator effects", () => {
  evaluated("class C{tag:uint8|string=\"\";operator+(rhs:uint8):boolean{this.tag=\"s\";return true;}}function f(c:C){const {tag}=c;if(c+uint8(1)){if(tag is uint8){if(c.tag is string){}}}}");
});

test("operator negation effects", () => {
  evaluated("class C{tag:uint8|string=\"\";operator!():boolean{this.tag=\"s\";return true;}}function f(c:C){const {tag}=c;if(!c){if(tag is uint8){if(c.tag is string){}}}}");
});

test("runtime: short circuit: established-truth", () => {
  expect(evaluated("function f(x:string){if(x!==\"\")return String(Boolean(x));return \"empty\";}f(\"a\");")).toBe("true");
});

test("runtime: short circuit: replacement-live", () => {
  expect(evaluated("function f(x:string,y:string){let n=0;if(x!==\"\"){x=y;x||(n=1);}return String(n);}f(\"a\",\"\");")).toBe("1");
});

test("runtime: short circuit: nan-is-falsy", () => {
  expect(evaluated("function f(x:number){if(x!==0)return String(Boolean(x));return \"zero\";}f(NaN);")).toBe("false");
});

test("runtime: NaN self comparison: nan-self", () => {
  expect(evaluated("function f(x:number){if(Number.isNaN(x))return String(x===x);return \"other\";}f(NaN);")).toBe("false");
});

test("runtime: NaN self comparison: notnan-self", () => {
  expect(evaluated("function f(x:number){if(!Number.isNaN(x))return String(x!==x);return \"other\";}f(Infinity);")).toBe("false");
});

test("runtime: NaN self comparison: getter-not-identity", () => {
  expect(evaluated("let n=0;const o:{x:number}={get x(){return n++;}};function f(o:{x:number}){return String(o.x!==o.x);}f(o);")).toBe("true");
});

test("runtime: numeric categories: integer-finite", () => {
  expect(evaluated("function f(x:number){if(Number.isInteger(x))return String(Number.isFinite(x));return \"other\";}f(9007199254740992);")).toBe("true");
});

test("runtime: numeric categories: finite-fraction", () => {
  expect(evaluated("function f(x:number){if(Number.isFinite(x))return String(Number.isInteger(x));return \"other\";}f(0.5);")).toBe("false");
});

test("runtime: numeric categories: integral-not-safe", () => {
  expect(evaluated("function f(x:number){if(Number.isInteger(x))return String(Number.isSafeInteger(x));return \"other\";}f(9007199254740992);")).toBe("false");
});

test("runtime: typeof pairs: pair-selection", () => {
  expect(evaluated("function f(x:uint8|string,y:string|boolean){if(typeof x===typeof y)return String(x is uint8);return \"other\";}f(\"a\",\"b\");")).toBe("false");
});

test("runtime: typeof pairs: tag-collision", () => {
  expect(evaluated("function f(x:uint8|uint16|string,y:uint8|string){if(typeof x===typeof y)return String(x is uint8);return \"other\";}f(uint16(1),uint8(2));")).toBe("false");
});

test("runtime: typeof pairs: tag-collision-other", () => {
  expect(evaluated("function f(x:uint8|uint16|string,y:uint8|string){if(typeof x===typeof y)return String(x is uint8);return \"other\";}f(uint8(1),uint8(2));")).toBe("true");
});

test("runtime: equality relations: equality-relation", () => {
  expect(evaluated("function f(x:uint8|string,y:uint8|string){if(x===y){if(x is uint8)return String(y is string);}return \"other\";}f(uint8(1),uint8(1));")).toBe("false");
});

test("runtime: equality relations: equality-replacement", () => {
  expect(evaluated("function f(x:uint8|string,y:uint8|string,z:uint8|string){if(x===y){y=z;if(x is uint8)return String(y is string);}return \"other\";}f(uint8(1),uint8(1),\"changed\");")).toBe("true");
});

test("runtime: equality relations: zero-signs-distinct", () => {
  expect(evaluated("function f(x:number,y:number){if(x===y)return String(Object.is(x,-0))+\",\"+String(Object.is(y,0));return \"other\";}f(-0,0);")).toBe("true,true");
});

test("runtime: SameValue: string-selection", () => {
  expect(evaluated("function f(x:uint8|string){if(Object.is(x,\"a\"))return String(x is uint8);return \"other\";}f(\"a\");")).toBe("false");
});

test("runtime: SameValue: nan-selection", () => {
  expect(evaluated("function f(x:number){if(Object.is(x,NaN))return String(Number.isFinite(x));return \"other\";}f(NaN);")).toBe("false");
});

test("runtime: SameValue: zero-miss-live", () => {
  expect(evaluated("function f(x:number){if(!Object.is(x,-0))return String(x===0);return \"other\";}f(0);")).toBe("true");
});

test("runtime: SameValue: replaced-intrinsic", () => {
  expect(evaluated("Object.is=()=>true;function f(x:uint8|string){if(Object.is(x,\"a\"))return String(x is uint8);return \"other\";}f(uint8(1));")).toBe("true");
});

test("runtime: assignment results: scalar-assignment", () => {
  expect(evaluated("function f(x:string,y:string){if(x=y)return String(y===\"\");return \"other\";}f(\"\",\"a\");")).toBe("false");
});

test("runtime: assignment results: setter-replaces-source", () => {
  expect(evaluated("function f(y:string){const box:{x:string}={get x(){return \"old\";},set x(v:string){y=\"\";}};if(box.x=y)return String(y===\"\");return \"other\";}f(\"a\");")).toBe("true");
});

test("runtime: assignment results: assignment-value", () => {
  expect(evaluated("function f(x:string,y:string){return String(Boolean(x=y))+\",\"+x;}f(\"\",\"a\");")).toBe("true,a");
});

test("runtime: operator results: declared-true", () => {
  expect(evaluated("class C{operator+(x:uint8):true{return true;}}function f(c:C){return String(c+uint8(1));}f(new C());")).toBe("true");
});

test("runtime: operator results: compound-does-not-rebind", () => {
  expect(evaluated("class C{operator+=(x:uint8):true{return true;}}function f(c:C){const alias:C=c;const answer=c+=uint8(1);return String(answer)+\",\"+String(c===alias);}f(new C());")).toBe("true,true");
});

test("runtime: operator results: boolean-both", () => {
  expect(evaluated("class C{b:boolean=false;operator+(x:uint8):boolean{return this.b;}}function f(c:C){return String(c+uint8(1));}const c:C=new C();const first=f(c);c.b=true;first+\",\"+f(c);")).toBe("false,true");
});

test("runtime: data destructuring: data-copy", () => {
  expect(evaluated("class C{tag:uint8|string=\"\";}function f(x:C){const {tag}=x;if(tag is uint8)return String(x.tag is string);return \"other\";}const c:C=new C();c.tag=uint8(1);f(c);")).toBe("false");
});

test("runtime: data destructuring: later-getter", () => {
  expect(evaluated("class C{tag:uint8|string=\"\";get other(){this.tag=\"changed\";return 0;}}function f(x:C){const {tag,other}=x;if(tag is uint8)return String(x.tag is string);return \"other\";}const c:C=new C();c.tag=uint8(1);f(c);")).toBe("true");
});

test("runtime: data destructuring: source-write", () => {
  expect(evaluated("class C{tag:uint8|string=\"\";}function f(x:C,y:uint8|string){const {tag}=x;x.tag=y;if(tag is uint8)return String(x.tag is string);return \"other\";}const c:C=new C();c.tag=uint8(1);f(c,\"changed\");")).toBe("true");
});

test("runtime: object results: empty-collection", () => {
  expect(evaluated("function f(x:uint8|string){const out=match all(x){when uint8:0;};return String(out.length)+\",\"+String(Boolean(out));}f(\"none\");")).toBe("0,true");
});

test("runtime: object results: lazy-generator", () => {
  expect(evaluated("let n=0;const g=do * {n++;yield 1;};String(Boolean(g))+\",\"+String(n);")).toBe("true,0");
});

test("runtime: object results: lazy-async-generator", () => {
  expect(evaluated("let n=0;const g=async do * {n++;yield 1;};String(Boolean(g))+\",\"+String(n);")).toBe("true,0");
});

test("runtime: derived comparison results", () => {
  expect(evaluated("class C{operator<(c:C):true{return true;}}function f(a:C,b:C){return String(a>b)+\",\"+String(a>=b)+\",\"+String(a<=b);}f(new C(),new C());")).toBe("true,false,false");
});

test("runtime: equality result conversion", () => {
  expect(evaluated("class C{operator==(c:C):object{return {};}}function f(a:C,b:C){const equal:boolean=a==b;const different:boolean=a!=b;return String(equal)+\",\"+String(different);}f(new C(),new C());")).toBe("true,false");
});

test("runtime: overloaded not result", () => {
  expect(evaluated("class C{flag:boolean=false;constructor(flag:boolean){this.flag=flag;}operator!():boolean{return this.flag;}}function f(c:C){if(!c)return \"yes\";return \"no\";}f(new C(true))+\",\"+f(new C(false));")).toBe("yes,no");
});

test("relation zero domain", () => {
  expectStaticTypeError("function f(a:number,b:number){if(a===b){if(Object.is(a,-0)){if(b){}}}}");
});

test("relation zero exclusion", () => {
  expectStaticTypeError("function f(a:number,b:number){if(a===b){if(a!==0){if(b===0){}}}}");
});
