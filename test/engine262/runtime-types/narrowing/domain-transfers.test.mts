import { expect, test } from 'vitest';
import { expectStaticTypeError, evaluated, evaluatedSequence } from '../harness.mts';

// #sec-narrowing-flow, #sec-typed-catch, #sec-divergence, #sec-pattern-static-semantics.

test("grouped-typeof: if", () => {
  expectStaticTypeError("function f(x:uint8|string){if((typeof x)===\"number\"){if(x is string){}}}");
});

test("grouped-typeof: mirrored", () => {
  expectStaticTypeError("function f(x:uint8|string){if(\"number\"===(typeof x)){if(x is string){}}}");
});

test("grouped-typeof: while", () => {
  expectStaticTypeError("function f(x:uint8|string){while((typeof x)===\"number\"){if(x is string){}break;}}");
});

test("grouped-typeof: logical", () => {
  expectStaticTypeError("function f(x:uint8|string){if((typeof x)===\"number\" && (x is string)){}}");
});

test("grouped-typeof: direct", () => {
  expectStaticTypeError("function f(x:uint8|string){if(typeof x===\"number\"){if(x is string){}}}");
});

test("grouped-typeof: changed-subject", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if((typeof x)===\"number\"){x=y;if(x is string){}}}");
});

test("grouped-typeof: effectful-wrapper", () => {
  evaluated("function f(x:uint8|string,y:uint8|string,k:string){if((typeof x,x=y,k)===\"number\"){if(x is string){}}}");
});

test("grouped-typeof: unknown-tag", () => {
  evaluated("function f(x:uint8|string,k:string){if((typeof x)===k){if(x is string){}}}");
});

test("computed-discriminant: literal-key", () => {
  expectStaticTypeError("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string}){if(x[\"tag\"]===\"a\"){if(x.v is string){}}}");
});

test("computed-discriminant: const-key", () => {
  expectStaticTypeError("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string}){const key=\"tag\";if(x[key]===\"a\"){if(x.v is string){}}}");
});

test("computed-discriminant: conditional", () => {
  expectStaticTypeError("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string}){return x[\"tag\"]===\"a\" ? (x.v is string ? 1:2):3;}");
});

test("computed-discriminant: switch", () => {
  expectStaticTypeError("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string}){switch(x[\"tag\"]){case \"a\":if(x.v is string){}break;}}");
});

test("computed-discriminant: dot-key", () => {
  expectStaticTypeError("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string}){if(x.tag===\"a\"){if(x.v is string){}}}");
});

test("computed-discriminant: unknown-key", () => {
  evaluated("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string},key:string){if(x[key]===\"a\"){if(x.v is string){}}}");
});

test("computed-discriminant: replaced-root", () => {
  evaluated("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string},y:{tag:\"a\",v:uint8}|{tag:\"b\",v:string}){if(x[\"tag\"]===\"a\"){x=y;if(x.v is string){}}}");
});

test("computed-discriminant: different-key", () => {
  evaluated("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string},key:string){if(x[key]===\"a\"){if(x.tag===\"b\"){}}}");
});

test("catch-residual: residual", () => {
  expectStaticTypeError("function f(g:any){try{g();}catch(e:uint8){}catch(e:uint8|string){if(e is uint8){}}}");
});

test("catch-residual: several", () => {
  expectStaticTypeError("function f(g:any){try{g();}catch(e:uint8){}catch(e:string){}catch(e:uint8|string|boolean){if(e is boolean){}}}");
});

test("catch-residual: catch-loop", () => {
  expectStaticTypeError("function f(g:any){try{g();}catch(e:uint8){}catch(e:uint8|string){while(e is uint8){break;}}}");
});

test("catch-residual: covered-handler", () => {
  expectStaticTypeError("function f(g:any){try{g();}catch(e:uint8|string){}catch(e:uint8){}}");
});

test("catch-residual: remaining-alternatives", () => {
  evaluated("function f(g:any){try{g();}catch(e:uint8){}catch(e:uint8|string|boolean){if(e is string){}}}");
});

test("catch-residual: reassigned-parameter", () => {
  evaluated("function f(g:any,y:uint8|string){try{g();}catch(e:uint8){}catch(e:uint8|string){e=y;if(e is uint8){}}}");
});

test("catch-residual: first-handler", () => {
  evaluated("function f(g:any){try{g();}catch(e:uint8|string){if(e is uint8){}}}");
});

test("never-call: if-call", () => {
  expectStaticTypeError("function stop():never{throw 0;}function f(x:uint8|string){if(x is uint8)stop();if(x is uint8){}}");
});

test("never-call: switch-call", () => {
  expectStaticTypeError("function stop():never{throw 0;}function f(x:uint8|string){switch(typeof x){case \"number\":stop();}if(x is uint8){}}");
});

test("never-call: short-circuit", () => {
  expectStaticTypeError("function stop():never{throw 0;}function f(x:uint8|string){if((x is uint8)||stop()){if(x is string){}}}");
});

test("never-call: loop-break", () => {
  expectStaticTypeError("function stop():never{throw 0;}function f(x:uint8|string){while(true){if(x is uint8)stop();break;}if(x is uint8){}}");
});

test("never-call: explicit-throw", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8)throw 0;if(x is uint8){}}");
});

test("never-call: may-return", () => {
  evaluated("function stop():void{}function f(x:uint8|string){if(x is uint8)stop();if(x is uint8){}}");
});

test("never-call: caught-throw", () => {
  evaluated("function stop():never{throw 0;}function f(x:uint8|string){try{if(x is uint8)stop();}catch{}if(x is uint8){}}");
});

test("never-call: promise-of-never", () => {
  evaluated("async function stop():Promise.<never>{throw 0;}function f(x:uint8|string){if(x is uint8)stop();if(x is uint8){}}");
});

test("truthiness-parts: true-branch", () => {
  expectStaticTypeError("function f(b:boolean){if(b){if(b===false){}}}");
});

test("truthiness-parts: false-branch", () => {
  expectStaticTypeError("function f(b:boolean){if(b){}else{if(b===true){}}}");
});

test("truthiness-parts: for-test", () => {
  expectStaticTypeError("function f(b:boolean){for(;b;){if(b===false){}break;}}");
});

test("truthiness-parts: do-test", () => {
  expectStaticTypeError("function f(b:boolean){do{if(!b)break;}while(b===false);}");
});

test("truthiness-parts: nullable-true", () => {
  expectStaticTypeError("function f(b:boolean|null){if(b){if(b===false){}}}");
});

test("truthiness-parts: explicit-true", () => {
  expectStaticTypeError("function f(b:boolean){if(b===true){if(b===false){}}}");
});

test("truthiness-parts: write", () => {
  evaluated("function f(b:boolean,c:boolean){if(b){b=c;if(b===false){}}}");
});

test("truthiness-parts: numeric-zero", () => {
  evaluated("function f(n:uint8){if(n){}else{if(n is 0){}}}");
});

test("truthiness-parts: nullable-false", () => {
  evaluated("function f(b:boolean|null){if(b){}else{if(b===false){}}}");
});

test("optional-selection: literal", () => {
  expectStaticTypeError("function f(o:{tag:\"a\"|\"b\"}|null){if(o?.tag===\"a\"){if(o is null){}}}");
});

test("optional-selection: not-undefined", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){if(o?.tag!==undefined){if(o is null){}}}");
});

test("optional-selection: case", () => {
  expectStaticTypeError("function f(o:{tag:\"a\"|\"b\"}|null){switch(o?.tag){case \"a\":if(o is null){}break;}}");
});

test("optional-selection: truthy-result", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){if(o?.tag){if(o is null){}}}");
});

test("optional-selection: undefined-result", () => {
  evaluated("function f(o:{tag:string|undefined}|null){if(o?.tag===undefined){if(o is null){}}}");
});

test("optional-selection: inequality", () => {
  evaluated("function f(o:{tag:\"a\"|\"b\"}|null){if(o?.tag!==\"a\"){if(o is null){}}}");
});

test("optional-selection: computed-key-write", () => {
  evaluated("function f(o:{tag:string}|null,y:{tag:string}|null){if(o?.[(o=y,\"tag\")]===\"a\"){if(o is null){}}}");
});

test("optional-selection: getter-write", () => {
  evaluated("function f(o:{readonly tag:string}|null){function make():{readonly tag:string}|null{return {get tag():string{o=null;return \"a\";}};}o=make();if(o?.tag===\"a\"){if(o is null){}}}");
});

test("equality-domains: one-known-domain", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8){if(x===y){if(x is string){}}}");
});

test("equality-domains: two-unions", () => {
  expectStaticTypeError("function f(x:string|boolean,y:string|uint8){if(x===y){if(x is boolean){}}}");
});

test("equality-domains: false-inequality", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8){if(x!==y){}else{if(x is string){}}}");
});

test("equality-domains: right-subject", () => {
  expectStaticTypeError("function f(x:string|boolean,y:string|uint8){if(x===y){if(y is uint8){}}}");
});

test("equality-domains: explicit-type", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8){if(x is string){}}}");
});

test("equality-domains: inequality", () => {
  evaluated("function f(x:uint8|string,y:uint8){if(x!==y){if(x is string){}}}");
});

test("equality-domains: coercing", () => {
  evaluated("function f(x:number|string,y:number){if(x==y){if(x is string){}}}");
});

test("equality-domains: later-operand-write", () => {
  evaluated("function f(x:uint8|string,y:uint8,z:uint8|string){if(x===(x=z,y)){if(x is string){}}}");
});

test("equality-domains: overlap-remains", () => {
  evaluated("function f(x:string|boolean,y:string|boolean){if(x===y){if(x is boolean){}}}");
});

test("nullish-coverage: nullish-domain", () => {
  expectStaticTypeError("function f(x:null|undefined){switch(x){case null:return 1;case undefined:return 2;default:return 3;}}");
});

test("nullish-coverage: default-between", () => {
  expectStaticTypeError("function f(x:null|undefined){switch(x){case null:return 1;default:return 3;case undefined:return 2;}}");
});

test("nullish-coverage: aliased-domain", () => {
  expectStaticTypeError("type MaybeAbsent=null|undefined;function f(x:MaybeAbsent){switch(x){case null:return 1;case undefined:return 2;default:return 3;}}");
});

test("nullish-coverage: fallthrough", () => {
  expectStaticTypeError("function f(x:null|undefined){switch(x){case null:case undefined:default:return 3;}}");
});

test("nullish-coverage: boolean-domain", () => {
  expectStaticTypeError("function f(x:boolean){switch(x){case true:return 1;case false:return 2;default:return 3;}}");
});

test("nullish-coverage: missing-null", () => {
  evaluated("function f(x:null|undefined){switch(x){case undefined:return 2;default:return 3;}}");
});

test("nullish-coverage: another-member", () => {
  evaluated("function f(x:null|undefined|string){switch(x){case null:return 1;case undefined:return 2;default:return 3;}}");
});

test("nullish-coverage: literal-union-policy", () => {
  evaluated("function f(x:true|false){switch(x){case true:return 1;case false:return 2;default:return 3;}}");
});

test("bounded-pattern: range", () => {
  expectStaticTypeError("function f<T:type extends uint8>(x:T){if(x is 300..=400){}}");
});

test("bounded-pattern: range-match", () => {
  expectStaticTypeError("function f<T:type extends uint8>(x:T){return match(x){when 300..=400:1;default:2;};}");
});

test("bounded-pattern: covering-range", () => {
  expectStaticTypeError("function f<T:type extends uint8>(x:T){if(x is 0..=255){}}");
});

test("bounded-pattern: negated-range", () => {
  expectStaticTypeError("function f<T:type extends uint8>(x:T){if(x is not 300..=400){}}");
});

test("bounded-pattern: concrete-range", () => {
  expectStaticTypeError("function f(x:uint8){if(x is 300..=400){}}");
});

test("bounded-pattern: partial-range", () => {
  evaluated("function f<T:type extends uint8>(x:T){if(x is 0..=100){}}");
});

test("bounded-pattern: unbounded", () => {
  evaluated("function f<T:type>(x:T){if(x is 300..=400){}}");
});

test("bounded-pattern: value-query", () => {
  evaluated("function f<T:type extends uint8>(x:T){return x is 300..=400;}");
});

test("numeric-result: switch", () => {
  expectStaticTypeError("function f(x:uint8){switch(Number.isNaN(x)){case true:break;default:break;}}");
});

test("numeric-result: finite-switch", () => {
  expectStaticTypeError("function f(x:uint8){switch(Number.isFinite(x)){case false:break;default:break;}}");
});

test("numeric-result: match", () => {
  expectStaticTypeError("function f(x:uint8){return match(Number.isNaN(x)){when true:1;default:2;};}");
});

test("numeric-result: equality", () => {
  expectStaticTypeError("function f(x:uint8){if(Number.isNaN(x)===true){}}");
});

test("numeric-result: direct", () => {
  expectStaticTypeError("function f(x:uint8){if(Number.isNaN(x)){}}");
});

test("numeric-result: unknown-float", () => {
  evaluated("function f(x:float64){switch(Number.isNaN(x)){case true:break;default:break;}}");
});

test("numeric-result: value-query", () => {
  evaluated("function f(x:uint8){return Number.isNaN(x);}");
});

test("numeric-result: shadowed-number", () => {
  evaluated("function f(x:uint8,Number:any){switch(Number.isNaN(x)){case true:break;default:break;}}");
});

test("numeric-result: replaced-intrinsic", () => {
  evaluated("function f(x:uint8){Number.isNaN=(v:any):boolean=>true;switch(Number.isNaN(x)){case true:break;default:break;}}");
});

test("runtime: parenthesized-typeof", () => {
  expect(evaluated("function f(x:uint8|string){if((typeof x)===\"number\")return x is string;return \"other\";}String(f(uint8(1)))+\",\"+String(f(\"s\"));")).toBe("false,other");
});

test("runtime: computed-discriminant", () => {
  expect(evaluated("function f(x:{tag:\"a\",v:uint8}|{tag:\"b\",v:string}){if(x[\"tag\"]===\"a\")return x.v is string;return \"other\";}String(f({tag:\"a\",v:uint8(1)}))+\",\"+String(f({tag:\"b\",v:\"s\"}));")).toBe("false,other");
});

test("runtime: typed-catch-order", () => {
  expect(evaluated("function f(v:any){try{throw v;}catch(e:uint8){return \"byte\";}catch(e:uint8|string){return typeof e;}}f(uint8(1))+\",\"+f(\"s\");")).toBe("byte,string");
});

test("runtime: never-return", () => {
  expect(evaluated("function stop():never{throw 0;}function f(x:uint8|string){if(x is uint8)stop();return x is uint8;}let a=\"\";try{f(uint8(1));}catch{a=\"threw\";}a+\",\"+String(f(\"s\"));")).toBe("threw,false");
});

test("runtime: bare-boolean", () => {
  expect(evaluated("function f(b:boolean){if(b)return b===false;return b===true;}String(f(true))+\",\"+String(f(false));")).toBe("false,false");
});

test("runtime: nullable-false-value", () => {
  expect(evaluated("function f(b:boolean|null){if(b)return false;return b===false;}String(f(false))+\",\"+String(f(null));")).toBe("true,false");
});

test("runtime: optional-result", () => {
  expect(evaluated("function f(o:{tag:\"a\"|\"b\"}|null){if(o?.tag===\"a\")return o is null;return \"other\";}String(f({tag:\"a\"}))+\",\"+String(f(null));")).toBe("false,other");
});

test("runtime: optional-key-mutation", () => {
  expect(evaluated("function f(o:{tag:string}|null,y:{tag:string}|null){if(o?.[(o=y,\"tag\")]===\"a\")return o is null;return false;}String(f({tag:\"a\"},null));")).toBe("true");
});

test("runtime: optional-getter-mutation", () => {
  expect(evaluated("function f(o:{readonly tag:string}|null){function make():{readonly tag:string}|null{return {get tag():string{o=null;return \"a\";}};}o=make();if(o?.tag===\"a\")return o is null;return false;}String(f(null));")).toBe("true");
});

test("runtime: two-value-equality", () => {
  expect(evaluated("function f(x:uint8|string,y:uint8){if(x===y)return x is string;return \"other\";}String(f(uint8(1),uint8(1)))+\",\"+String(f(\"1\",uint8(1)));")).toBe("false,other");
});

test("runtime: equality-later-write", () => {
  expect(evaluated("function f(x:uint8|string,y:uint8,z:uint8|string){if(x===(x=z,y))return x is string;return false;}String(f(uint8(1),uint8(1),\"s\"));")).toBe("true");
});

test("runtime: coercing-equality", () => {
  expect(evaluated("function f(x:number|string,y:number){if(x==y)return x is string;return false;}String(f(\"1\",1));")).toBe("true");
});

test("runtime: generic-range-bound", () => {
  expect(evaluated("function f<T:type extends uint8>(x:T){return x is 300..=400;}String(f.<uint8>(uint8(0)))+\",\"+String(f.<uint8>(uint8(255)));")).toBe("false,false");
});

test("runtime: numeric-predicate", () => {
  expect(evaluated("function f(x:uint8){return Number.isNaN(x);}function g(x:uint8){return Number.isFinite(x);}String(f(uint8(1)))+\",\"+String(g(uint8(1)));")).toBe("false,true");
});

test("runtime: numeric-predicate-replaced", () => {
  expect(evaluated("Number.isNaN=(v:any):boolean=>true;function f(x:uint8){switch(Number.isNaN(x)){case true:return \"true\";default:return \"false\";}}f(uint8(1));")).toBe("true");
});

test("runtime: nullish-switch", () => {
  expect(evaluated("function f(x:null|undefined){switch(x){case null:return \"null\";case undefined:return \"undefined\";}}f(null)+\",\"+f(undefined);")).toBe("null,undefined");
});

test("runtime: nullish-fallthrough", () => {
  expect(evaluated("function f(x:null|undefined){switch(x){case null:default:return \"body\";}}f(null)+\",\"+f(undefined);")).toBe("body,body");
});

test("computed key cannot collide with a nested path", () => {
  evaluated("function f(x:{\"a.b\":uint8|string,a:{b:uint8|string}}){if(x[\"a.b\"] is uint8){if(x.a.b is string){}}}");
});

test("computed key shares dot invalidation", () => {
  evaluated("function f(x:{tag:uint8|string},y:uint8|string){if(x[\"tag\"] is uint8){x.tag=y;if(x[\"tag\"] is string){}}}");
});

test("computed punctuation is a stable field", () => {
  expectStaticTypeError("function f(x:{\"a.b\":uint8|string}){if(x[\"a.b\"] is uint8){if(x[\"a.b\"] is string){}}}");
});

test("computed discriminant has an empty key", () => {
  expectStaticTypeError("function f(x:{\"\":\"a\",v:uint8}|{\"\":\"b\",v:string}){if(x[\"\"]===\"a\"){if(x.v is string){}}}");
});

test("nullable numeric false edge retains zero", () => {
  evaluated("function f(x:uint8|null){if(x){}else{if(x is uint8){}}}");
});

test("nullable string false edge retains empty string", () => {
  evaluated("function f(x:string|undefined){if(x){}else{if(x is string){}}}");
});

test("Boolean negation swaps literal parts", () => {
  expectStaticTypeError("function f(b:boolean){if(!b){if(b===true){}}}");
});

test("structural catch filters do not subtract unstable membership", () => {
  evaluated("function f(g:any){try{g();}catch(e:{a:uint8}){}catch(e:{a:uint8}|null){if(e is null){}}}");
});

test("never call satisfies a declared return", () => {
  evaluated("function stop():never{throw 0;}function f():uint8{stop();}");
});

test("never finalizer removes normal completion", () => {
  expectStaticTypeError("function stop():never{throw 0;}function f(x:uint8|string){if(x is uint8){try{}finally{stop();}}if(x is uint8){}}");
});

test("caught never call retains normal completion", () => {
  evaluated("function stop():never{throw 0;}function f(x:uint8|string){if(x is uint8){try{stop();}catch{}}if(x is uint8){}}");
});

test("never call in a completion block retains the live producer", () => {
  expectStaticTypeError("function stop():never{throw 0;}function f(x:uint8|string){if(do{if(x is uint8)stop(); x is string;}){}}");
});

test("optional comparison with reversed operands", () => {
  expectStaticTypeError("function f(o:{tag:\"a\"|\"b\"}|null){if(\"a\"===o?.tag){if(o is null){}}}");
});

test("optional undefined comparison false edge is present", () => {
  expectStaticTypeError("function f(o:{tag:string}|null){if(o?.tag===undefined){}else{if(o is null){}}}");
});

test("optional comparison suffix getter may change the receiver", () => {
  evaluated("function f(o:{tag:string}|null){const p={get tag():string{o=null;return \"a\";}};if(o?.tag===p.tag){if(o is null){}}}");
});

test("optional switch label may change the receiver", () => {
  evaluated("function f(o:{tag:string}|null,y:{tag:string}|null){switch(o?.tag){case(o=y,\"a\"):if(o is null){}break;}}");
});

test("optional switch fallthrough keeps a null alternative", () => {
  evaluated("function f(o:{tag:string}|null){switch(o?.tag){case undefined:case \"a\":if(o is null){}break;}}");
});

test("equality right getter may change the earlier place", () => {
  evaluated("function f(x:uint8|string){const o={get value():uint8{x=\"s\";return 1;}};if(x===o.value){if(x is string){}}}");
});

test("equal common Boolean domain remains inhabited twice", () => {
  evaluated("function f(x:string|boolean,y:boolean|uint8){if(x===y){if(x){}}}");
});

test("equal false inequality removes incompatible right domain", () => {
  expectStaticTypeError("function f(x:string|boolean,y:string|uint8){if(x!==y){}else{if(y is uint8){}}}");
});

test("range match retains generic binding identity", () => {
  evaluated("function f<T:type extends uint8>(x:T):T{return match(x){when 0..=100:x;default:x;};}");
});

test("unbounded range match stays conservative", () => {
  evaluated("function f<T:type>(x:T){return match(x){when 300..=400:1;default:2;};}");
});

test("generic full-range match makes a later clause unreachable", () => {
  expectStaticTypeError("function f<T:type extends uint8>(x:T){return match(x){when 0..=255:1;when 256..=300:2;default:3;};}");
});

test("numeric predicate supplies an explicitly inferred binding", () => {
  evaluated("function f(x:uint8){const p:=Number.isNaN(x);let q:boolean=p;}");
});

test("numeric predicate does not infer an untyped let contract", () => {
  evaluated("function f(x:uint8){let p=Number.isNaN(x);if(p){}}");
});

test("numeric predicate computed replacement keeps a live true case", () => {
  evaluated("Number[\"isNaN\"]=(v:any):boolean=>true;function f(x:uint8){if(Number.isNaN(x)){}}");
});

test("numeric predicate unknown caller defeats intrinsic origin", () => {
  evaluated("function f(x:uint8,g:any){g();if(Number.isNaN(x)){}}");
});

test("numeric predicate reflective write defeats intrinsic origin", () => {
  evaluated("Reflect.set(Number,\"isNaN\",(v:any):boolean=>true);function f(x:uint8){if(Number.isNaN(x)){}}");
});

test('numeric predicate identity is checked across scripts', () => {
  expect(evaluatedSequence([
    'Number.isNaN=(v:any):boolean=>true;',
    'function f(x:uint8){if(Number.isNaN(x))return "live";return "other";}f(uint8(1));',
  ])).toBe('live');
});

test('equality does not correlate successive open accessor results', () => {
  expect(evaluated(`
    let count=0;
    const o={get value():uint8|string{return count++===0 ? uint8(1) : "s";}};
    function f(o:{readonly value:uint8|string},y:uint8){
      count=0;
      if(o.value===y){if(o.value is string)return "live";}return "other";
    }
    f(o,uint8(1));
  `)).toBe('live');
});

test('optional selection does not correlate successive receiver accessor results', () => {
  expect(evaluated(`
    let count=0;
    const box={get value():{tag:string}|null{return count++===0 ? {tag:"a"} : null;}};
    function f(box:{readonly value:{tag:string}|null}){
      count=0;
      if(box.value?.tag==="a"){if(box.value is null)return "live";}return "other";
    }
    f(box);
  `)).toBe('live');
});

test('equality retains typed class data field facts', () => {
  expectStaticTypeError(`
    class Box {value:uint8|string="s";}
    function f(box:Box,y:uint8){if(box.value===y){if(box.value is string){}}}
  `);
});

test('shadowed predicate inside a called function defeats intrinsic origin', () => {
  evaluated(`
    function change(Number:any){Number.isNaN();}
    function f(x:uint8,g:any){change(g);if(Number.isNaN(x)){}}
  `);
});

test('a never call in the loop test has no return obligation', () => {
  evaluated('function stop():never{throw 0;}function f():uint8{do{}while(stop());}');
});

test('computed discriminant requires a selected value, not just a broad String type', () => {
  evaluated('function f(x:{tag:"a",v:uint8}|{tag:"b",v:string},k:string){if(x["tag"]===k){if(x.v is string){}}}');
});

test('a literal annotation establishes a constant computed key', () => {
  expectStaticTypeError('function f(x:{tag:"a",v:uint8}|{tag:"b",v:string}){const key:"tag"="tag";if(x[key]==="a"){if(x.v is string){}}}');
});

test('dynamic array String indices do not gain a stable path', () => {
  evaluated('function f(x:[].<uint8|string>){if(x["0"] is uint8){if(x["0"] is string){}}}');
});

test('generic range verdicts apply to match-all clauses', () => {
  expectStaticTypeError('function f<T:type extends uint8>(x:T){return match all(x){when 300..=400:1;};}');
});

test('generic negated range coverage excludes later clauses', () => {
  expectStaticTypeError('function f<T:type extends uint8>(x:T){return match(x){when not 300..=400:1;default:2;};}');
});

test('a required binary operand with a never result removes the completion', () => {
  evaluated('function stop():never{throw 0;}function f():uint8{stop()+1;}');
});

test('an optional never call leaves only its skipped path', () => {
  expectStaticTypeError('function f(stop:(()=>never)|null){stop?.();if(stop!==null){}}');
});

test('a never-returning tagged call removes its normal edge', () => {
  expectStaticTypeError('function stop(strings:any):never{throw 0;}function f(x:uint8|string){if(x is uint8)stop`tag`;if(x is uint8){}}');
});

test('array predicate shadowing does not establish an intrinsic result', () => {
  evaluated('function f(Array:any,s:string){if(Array.isArray(s)){}}');
});

test('array predicate replacement keeps a live true branch', () => {
  expect(evaluated('Array.isArray=(v:any):boolean=>true;function f(s:string){if(Array.isArray(s))return "live";return "other";}f("s");')).toBe('live');
});

test('array predicate unknown caller defeats intrinsic origin', () => {
  evaluated('function f(s:string,g:any){g();if(Array.isArray(s)){}}');
});

test('array predicate identity is checked across scripts', () => {
  expect(evaluatedSequence([
    'Array.isArray=(v:any):boolean=>true;',
    'function f(s:string){if(Array.isArray(s))return "live";return "other";}f("s");',
  ])).toBe('live');
});
