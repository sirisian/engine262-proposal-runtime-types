import { test } from 'vitest';
import { expectStaticTypeError, evaluated } from '../harness.mts';

// #sec-narrowing-flow, #sec-pattern-static-semantics, #sec-declared-narrowing.
const metadata = "type NBn = { bounds?: RangeBounds.<any> };\nmeta NBn { default = {};\n  subtype(sub, sup) { return sup.bounds === undefined || (sub.bounds !== undefined && sup.bounds.contains(sub.bounds)); }\n  validate(v, c) { return c.bounds === undefined || c.bounds.contains(Number(v)); }\n  narrow(cur, op, val) {\n    const b = cur.bounds === undefined ? .. : cur.bounds;\n    if (op === \">=\") return { bounds: b.intersect(val..) };\n    if (op === \">\") return { bounds: b.intersect(val<..) };\n    if (op === \"<=\") return { bounds: b.intersect(..=val) };\n    if (op === \"<\") return { bounds: b.intersect(..<val) };\n    return cur;\n  } }";

test("match-path", () => {
  expectStaticTypeError("function f(o:{x:uint8|string}){return match(o.x){when uint8: o.x is string ? 1:2; default:3;};}");
});

test("match-parenthesis", () => {
  expectStaticTypeError("function f(x:uint8|string){return match((x)){when uint8: x is string ? 1:2; default:3;};}");
});

test("match-path-control", () => {
  expectStaticTypeError("function f(x:uint8|string){return match(x){when uint8:x is string ? 1:2;default:3;};}");
});

test("match-path-mutation-live", () => {
  evaluated("function f(o:{x:uint8|string},y:uint8|string){return match(o.x){when uint8:do{o.x=y;o.x is string ? 1:2;};default:3;};}");
});

test("match-literal-string", () => {
  expectStaticTypeError("function f(x:string){return match(x){when \"a\":x === \"b\" ? 1:2;default:3;};}");
});

test("match-literal", () => {
  expectStaticTypeError("function f(x:uint8){return match(x){when 1: x === 2 ? 1:2; default:3;};}");
});

test("match-literal-guard", () => {
  expectStaticTypeError("function f(x:string){return match(x){when \"a\" if(x === \"b\"):1;default:2;};}");
});

test("match-literal-control", () => {
  expectStaticTypeError("function f(x:string){if(x === \"a\"){if(x === \"b\"){}}}");
});

test("match-literal-live", () => {
  evaluated("function f(x:string){return match(x){when \"a\":1;default:x === \"b\" ? 2:3;};}");
});

test("match-guard-failure", () => {
  expectStaticTypeError("function f(x:uint8|string){return match(0){when let v if(x is uint8):1; default:x is uint8 ? 2:3;};}");
});

test("match-guard-failed-control", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8)return;return x is uint8 ? 1:2;}");
});

test("match-guard-effect-live", () => {
  evaluated("function f(x:uint8|string,y:uint8|string,b:boolean){return match(0){when let v if((x is uint8) && (x=y,b)):1;default:x is uint8 ? 2:3;};}");
});

test("match-guard-refutable-live", () => {
  evaluated("function f(x:uint8|string,b:boolean){return match(b){when true if(x is uint8):1;default:x is uint8 ? 2:3;};}");
});

test("switch-typeof-parenthesis", () => {
  expectStaticTypeError("function f(x:uint8|string){switch((typeof x)){case \"number\":if(x is string){}break;default:break;}}");
});

test("switch-boolean-parenthesis", () => {
  expectStaticTypeError("function f(x:uint8|string){switch((true)){case x is uint8:if(x is string){}break;default:break;}}");
});

test("switch-parenthesis-control", () => {
  expectStaticTypeError("function f(x:uint8|string){switch(typeof x){case \"number\":if(x is string){}break;default:break;}}");
});

test("switch-parenthesis-live", () => {
  evaluated("function f(x:uint8|uint16|string){switch((typeof x)){case \"number\":if(x is uint8){}break;default:break;}}");
});

test("switch-range-narrowed", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8){switch(x){case 300..<400:break;default:break;}}}");
});

test("switch-range-miss", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 300..<400:break;default:break;}}");
});

test("switch-range-pattern-control", () => {
  expectStaticTypeError("function f(x:uint8){if(x is 300..<400){}}");
});

test("switch-range-live", () => {
  evaluated("function f(x:uint8){switch(x){case 100..<200:break;default:break;}}");
});

test("switch-range-live-dynamic", () => {
  evaluated("function f(x:uint8,a:uint8,b:uint8){switch(x){case a..<b:break;default:break;}}");
});

test("do-result", () => {
  expectStaticTypeError("function f(x:uint8|string){if(do {x is uint8;}){if(x is string){}}}");
});

test("do-result-branch", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(do{if(b){x is uint8;}else{x is uint8;}}){if(x is string){}}}");
});

test("do-result-finally", () => {
  expectStaticTypeError("function f(x:uint8|string){if(do{try{x is uint8;}finally{}}){if(x is string){}}}");
});

test("do-result-control", () => {
  expectStaticTypeError("function f(x:uint8|string){if((0,x is uint8)){if(x is string){}}}");
});

test("do-result-live", () => {
  evaluated("function f(x:uint8|string,b:boolean){if(do {b ? x is uint8 : true;}){if(x is string){}}}");
});

test("coalesce-test", () => {
  expectStaticTypeError("function f(x:{a:uint8}|null){if(x ?? false){if(x === null){}}}");
});

test("coalesce-test-null", () => {
  expectStaticTypeError("function f(x:boolean|null){if(x ?? false){if(x === null){}}}");
});

test("coalesce-test-else", () => {
  expectStaticTypeError("function f(x:{a:uint8}|null){if(x ?? false){}else{if(x is null){}}}");
});

test("coalesce-control", () => {
  expectStaticTypeError("function f(x:{a:uint8}|null){if(x !== null){if(x === null){}}}");
});

test("coalesce-live-fallback", () => {
  evaluated("function f(x:{a:uint8}|null){if(x ?? true){if(x === null){}}}");
});

test("coalesce-mutation-live", () => {
  evaluated("function f(x:{a:uint8}|null,y:{a:uint8}|null){if(x ?? (x=y,true)){if(x === null){}}}");
});

test("preserving-parameter-store", () => {
  expectStaticTypeError("function f(x:uint8|string,y:uint8){if(x is uint8){x=y;if(x is string){}}}");
});

test("preserving-property-store", () => {
  expectStaticTypeError("function f(o:{x:uint8|string}){if(o.x is uint8){o.x=uint8(1);if(o.x is string){}}}");
});

test("preserving-store-control", () => {
  expectStaticTypeError("function f(x:uint8|string){if(x is uint8){if(x is string){}}}");
});

test("preserving-other-store", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(x is uint8){x=y;if(x is string){}}}");
});

test("assign-store-other-branch", () => {
  evaluated("function f(x:uint8|string,y:uint8){if(x is uint8){x=y;}if(x is string){}}");
});

test("tag-guard", () => {
  expectStaticTypeError("function guard(s:any,v:any):v is uint8{return v is uint8;}function f(x:uint8|string){if(guard`${x}`){if(x is string){}}}");
});

test("tag-guard-direct", () => {
  expectStaticTypeError("function guard(s:any,v:any):v is uint8{return v is uint8;}function f(x:uint8|string){if(guard([],x)){if(x is string){}}}");
});

test("tag-guard-live", () => {
  evaluated("function guard(s:any,v:any):v is uint8{return v is uint8;}function f(x:uint8|string,y:uint8|string){if(guard`${y}`){if(x is string){}}}");
});

test("metadata-path", () => {
  expectStaticTypeError(metadata + " function f(o:{v:float64.<{bounds:..}>}){if(o.v >= 0){if(o.v < 0){}}}");
});

test("metadata-parenthesis", () => {
  expectStaticTypeError(metadata + " function f(v:float64.<{bounds:..}>){if((v) >= 0){if(v < 0){}}}");
});

test("metadata-path-single-empty", () => {
  expectStaticTypeError(metadata + " function f(o:{v:float64.<{bounds:0..=10}>}){if(o.v > 20){}}");
});

test("metadata-id", () => {
  expectStaticTypeError(metadata + " function f(v:float64.<{bounds:..}>){if(v >= 0){if(v < 0){}}}");
});

test("metadata-path-live", () => {
  evaluated(metadata + " function f(o:{v:float64.<{bounds:..}>}){if(o.v >= 0){if(o.v < 10){}}}");
});

test("metadata-path-mutate", () => {
  evaluated(metadata + " function f(o:{v:float64.<{bounds:..}>},v:float64.<{bounds:..}>){if(o.v >= 0){o.v=v;if(o.v < 0){}}}");
});

test("tag-assertion", () => {
  expectStaticTypeError("function makeTag(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[{name:\"s\",type:type any},{name:\"v\",type:type any}],narrows:[{target:\"v\",type:type uint8}]}]});} type A=makeTag();const tag:A=(s,v)=>{};function f(x:uint8|string){tag`${x}`;if(x is string){}}");
});

test("tag-later-write", () => {
  evaluated("function guard(s:any,v:any,w:any):v is uint8{return v is uint8;}function f(x:uint8|string,y:uint8|string){if(guard`${x}${x=y}`){if(x is string){}}}");
});

test("do-finalizer-write", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(do{try{x is uint8;}finally{x=y;}}){if(x is string){}}}");
});

test("do-label-value", () => {
  expectStaticTypeError("function f(x:uint8|string){if(do{done:{x is uint8;break done;}}){if(x is string){}}}");
});

test("do-empty-after-value", () => {
  expectStaticTypeError("function f(x:uint8|string){if(do{x is uint8;;}){if(x is string){}}}");
});

test("do-finally-property-write", () => {
  evaluated("function f(o:{x:uint8|string},y:uint8|string){if(do{try{o.x is uint8;}finally{o.x=y;}}){if(o.x is string){}}}");
});

test("do-local-shadow", () => {
  evaluated("function f(x:uint8|string,y:uint8|string){if(do{let x:uint8|string=y;x is uint8;}){if(x is string){}}}");
});

test("do-finally-prefix-write", () => {
  evaluated("function f(o:{x:uint8|string},p:{x:uint8|string}){if(do{try{o.x is uint8;}finally{o=p;}}){if(o.x is string){}}}");
});

test("do-conditional-preview", () => {
  expectStaticTypeError("function f(x:uint8|string){return (do{x is uint8;}) ? x is string ? 1:2 : 3;}");
});

test("do-condition-loop", () => {
  expectStaticTypeError("function f(x:uint8|string){while(do{x is uint8;}){if(x is string){}break;}}");
});

test("do-guarded-false-alternative", () => {
  expectStaticTypeError("function f(x:uint8|string,b:boolean){if(do{if(b){x is uint8;}else{false;}}){if(x is string){}}}");
});

test("match-captured-prefix", () => {
  evaluated("function f(o:{x:uint8|string},p:{x:uint8|string},b:boolean){return match(o.x){when uint8 if(o=p,b):1;default:o.x is string ? 2:3;};}");
});

test("store-captured-prefix", () => {
  evaluated("function f(o:{x:uint8|string},p:{x:uint8|string},y:uint8){if(o.x is uint8){o.x=(o=p,y);if(o.x is string){}}}");
});

test("store-descendant-widen", () => {
  evaluated("function f(o:{x:{a:uint8|string}},p:{a:uint8|string}){if(o.x.a is uint8){o.x=p;if(o.x.a is string){}}}");
});

test("store-reads-old-fact", () => {
  evaluated("function f(x:uint8|string){if(x is uint8){x=x;let y:uint8=x;}}");
});

test("coalesce-false-keeps-null-or-false", () => {
  evaluated("function f(x:boolean|null){if(x??false){}else{if(x is null){}}}");
});

test("coalesce-nested-completion", () => {
  expectStaticTypeError("function f(x:{a:uint8}|null){if(do{x??false;}){if(x is null){}}}");
});

test("coalesce-loop-test", () => {
  expectStaticTypeError("function f(x:{a:uint8}|null){for(;x??false;){if(x is null){}break;}}");
});

test("switch-range-upper-touch", () => {
  evaluated("function f(x:uint8){switch(x){case 255..=256:break;default:break;}}");
});

test("switch-range-exclusive-lower", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case 255<..=256:break;default:break;}}");
});

test("switch-range-negative", () => {
  expectStaticTypeError("function f(x:uint8){switch(x){case -10..<-1:break;default:break;}}");
});

test("tag-false-branch", () => {
  expectStaticTypeError("function g(s:any,x:any):x is uint8{return x is uint8;}function f(x:uint8|string){if(g`${x}`){}else{if(x is uint8){}}}");
});

test("tag-parenthesized-place", () => {
  expectStaticTypeError("function g(s:any,x:any):x is uint8{return x is uint8;}function f(o:{x:uint8|string}){if(g`${(o.x)}`){if(o.x is string){}}}");
});

test("tag-later-property-write", () => {
  evaluated("function g(s:any,x:any,y:any):x is uint8{return x is uint8;}function f(o:{x:uint8|string},y:uint8|string){if(g`${o.x}${o.x=y}`){if(o.x is string){}}}");
});


test('do catch binding does not refine an outer name during a type query', () => {
  evaluated('function f(x:uint8|string){return (do{try{throw 0;}catch(x){x is uint8;}}) ? x is string ? 1:2 : 3;}');
});

test('do switch binding does not refine an outer name during a type query', () => {
  evaluated('function f(x:uint8|string,y:uint8|string,b:boolean){return (do{switch(b){case true:let x:uint8|string=y;x is uint8;break;default:false;}}) ? x is string ? 1:2 : 3;}');
});

test('do result facts type a conditional return arm', () => {
  evaluated('function f(x:uint8|string):uint8{return (do{x is uint8;}) ? x : 0;}');
});

test('coalescing result facts type a conditional return arm', () => {
  evaluated('function f(x:{a:uint8}|null):{a:uint8}{return (x??false) ? x : {a:0};}');
});

test('wide integer endpoints are not rounded into an empty switch interval', () => {
  evaluated('function f(x:uint64){switch(x){case 9007199254740992..<9007199254740993:break;default:break;}}');
});

test('metadata comparison cannot refine a place written by its other operand', () => {
  evaluated(metadata + ' function f(o:{v:float64.<{bounds:..}>},y:float64.<{bounds:..}>){if(o.v >= (o.v=y,0)){if(o.v < 0){}}}');
});

test('bare zero pattern retains both floating zero signs', () => {
  evaluated('function f(x:float64){return match(x){when 0:x is -0 ? 1:2;default:3;};}');
});

test('a numeric literal pattern keeps the adopted numeric value', () => {
  evaluated('function f(x:uint8){return match(x){when 1:x === 1;default:false;};}');
});

test('reflected template predicate defers until its annotation resolves', () => {
  evaluated('function makeTag(){return Reflect.makeType({kind:"function",signatures:[{parameters:[{name:"s",type:type any},{name:"v",type:type any}],return:{type:type boolean},narrows:[{target:"v",type:type uint8}]}]});} type G=makeTag();const tag:G=(s,v)=>v is uint8;function f(x:uint8|string){if(tag`${x}`){let y:uint8=x;}}');
});
