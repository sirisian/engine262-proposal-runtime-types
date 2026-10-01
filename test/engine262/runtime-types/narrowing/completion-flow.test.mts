import { test } from 'vitest';
import { expectStaticTypeError, evaluated } from '../harness.mts';

// #sec-narrowing-flow and #sec-declared-narrowing. Declarations are checked
// without invoking the functions, so an infinite loop cannot hide a failure.

test("void result cannot select a logical branch", () => {
  expectStaticTypeError("function g(): void {} function f(b: boolean) { if (g() || b) {} }");
});

test("negated void result cannot select a logical branch", () => {
  expectStaticTypeError("function g(): void {} function f(b: boolean) { if (!g() && b) {} }");
});

test("closed enum facts survive a block exit", () => {
  expectStaticTypeError("enum E { A, B, C } function f(e: E) { { if (e === E.A) return; } if (e === E.A) {} }");
});

test("sealed subclass facts survive a finalizer", () => {
  evaluated("sealed abstract class S {} class A extends S {} class B extends S {} function f(s: S) { try { if (s instanceof A) return; } finally {} let b: B = s; }");
});

test("logical-and", () => {
  expectStaticTypeError("function f(x: uint8 | string, y: uint8 | string) { if (x is uint8 && y is uint8) { if (y is string) {} } }");
});

test("logical-or", () => {
  expectStaticTypeError("function f(x: uint8 | string, y: uint8 | string) { if (x is uint8 || y is uint8) {} else { if (y is uint8) {} } }");
});

test("logical-same-subject", () => {
  expectStaticTypeError("function f(x: uint8 | string | boolean) { if (x is uint8 || x is string) { if (x is boolean) {} } }");
});

test("logical-and-always-true", () => {
  expectStaticTypeError("function f(x: uint8 | string, y: uint8 | string) { if (x is uint8 && y is uint8) { if (y is uint8) {} } }");
});

test("comma", () => {
  expectStaticTypeError("function f(x: uint8 | string) { if ((0, x is uint8)) { if (x is string) {} } }");
});

test("conditional-condition", () => {
  expectStaticTypeError("function f(b: boolean, x: uint8 | string) { if (b ? x is uint8 : x is uint8) { if (x is string) {} } }");
});

test("for-update", () => {
  expectStaticTypeError("function f(x: uint8 | string) { for (; x is uint8; x is string ? 1 : 2) {} }");
});

test("for-update-continue", () => {
  expectStaticTypeError("function f(x: uint8 | string) { for (;; x is string ? 1 : 2) { if (x is string) return; continue; } }");
});

test("do-condition", () => {
  expectStaticTypeError("function f(x: uint8 | string) { do { if (x is string) return; } while (x is string); }");
});

test("for-update-always-true", () => {
  expectStaticTypeError("function f(x: uint8 | string) { for (; x is uint8; x is uint8 ? 1 : 2) {} }");
});

test("while-exit", () => {
  expectStaticTypeError("function f(x: uint8 | string) { while (x is uint8) {} if (x is uint8) {} }");
});

test("for-exit", () => {
  expectStaticTypeError("function f(x: uint8 | string) { for (; x is uint8;) {} if (x is uint8) {} }");
});

test("do-exit", () => {
  expectStaticTypeError("function f(x: uint8 | string) { do {} while (x is uint8); if (x is uint8) {} }");
});

test("block-guard", () => {
  expectStaticTypeError("function f(x: uint8 | string) { { if (x is string) return; } if (x is string) {} }");
});

test("try-guard", () => {
  expectStaticTypeError("function f(x: uint8 | string) { try { if (x is string) return; } finally {} if (x is string) {} }");
});

test("label-break", () => {
  expectStaticTypeError("function f(x: uint8 | string) { out: { if (x is string) break out; return; } if (x is uint8) {} }");
});

test("switch-exit", () => {
  expectStaticTypeError("function f(x: \"a\" | \"b\") { switch (x) { case \"a\": return; default: break; } if (x === \"a\") {} }");
});

test("switch-typeof", () => {
  expectStaticTypeError("function f(x: uint8 | string) { switch (typeof x) { case \"number\": if (x is string) {} break; default: break; } }");
});

test("typeof-default", () => {
  expectStaticTypeError("function f(x: uint8 | string) { switch (typeof x) { case \"number\": break; default: if (x is uint8) {} } }");
});

test("switch-lexical", () => {
  expectStaticTypeError("function f(x: \"a\" | \"b\") { switch (x) { case \"a\": let unrelated = 0; if (x === \"b\") {} break; default: break; } }");
});

test("switch-boolean-default", () => {
  expectStaticTypeError("function f(x: uint8 | string | boolean) { switch (true) { default: if (x is uint8) {} break; case x is uint8: break; } }");
});

test("nullish-right", () => {
  expectStaticTypeError("function f(x: uint8 | null) { return x ?? (x is uint8 ? 1 : 2); }");
});

test("optional-argument", () => {
  expectStaticTypeError("function f(cb: ((x: number) => number) | null) { return cb?.(cb === null ? 1 : 2); }");
});

test("logical-assignment", () => {
  expectStaticTypeError("function f(x: uint8 | null) { x ??= (x is uint8 ? 1 : 2); }");
});

test("assert-parentheses", () => {
  expectStaticTypeError("function makeAssert() { return Reflect.makeType({ kind: \"function\", signatures: [{ parameters: [{ name: \"v\", type: type any }], narrows: [{ target: \"v\", type: type uint8 }] }] }); } type A = makeAssert(); const assertU8: A = (v) => {}; function f(x: uint8 | string) { (assertU8(x)); if (x is string) {} }");
});

test("assert-comma", () => {
  expectStaticTypeError("function makeAssert() { return Reflect.makeType({ kind: \"function\", signatures: [{ parameters: [{ name: \"v\", type: type any }], narrows: [{ target: \"v\", type: type uint8 }] }] }); } type A = makeAssert(); const assertU8: A = (v) => {}; function f(x: uint8 | string) { return (assertU8(x), x is string ? 1 : 2); }");
});

test("logical-live", () => {
  evaluated("function f(x: uint8 | string, y: uint8 | string | boolean) { if (x is uint8 && y is not string) { if (y is boolean) {} } }");
});

test("conditional-live", () => {
  evaluated("function f(b: boolean, x: uint8 | string, y: uint8 | string) { if (b ? x is uint8 : y is uint8) { if (x is string) {} } }");
});

test("for-update-mutated", () => {
  evaluated("function f(x: uint8 | string, y: uint8 | string) { for (; x is uint8; x is string ? 1 : 2) { x = y; } }");
});

test("while-exit-break", () => {
  evaluated("function f(x: uint8 | string) { while (x is uint8) { break; } if (x is uint8) {} }");
});

test("for-exit-break", () => {
  evaluated("function f(x: uint8 | string) { for (; x is uint8;) { break; } if (x is uint8) {} }");
});

test("do-exit-break", () => {
  evaluated("function f(x: uint8 | string) { do { break; } while (x is uint8); if (x is uint8) {} }");
});

test("block-guard-shadow", () => {
  evaluated("function f(x: uint8 | string, y: uint8 | string) { { let x: uint8 | string = y; if (x is string) return; } if (x is string) {} }");
});

test("try-finally-write", () => {
  evaluated("function f(x: uint8 | string, y: uint8 | string) { try { if (x is string) return; } finally { x = y; } if (x is string) {} }");
});

test("switch-typeof-live", () => {
  evaluated("function f(x: uint8 | uint16 | string) { switch (typeof x) { case \"number\": if (x is uint8) {} break; default: break; } }");
});

test("switch-lexical-write", () => {
  evaluated("function f(x: \"a\" | \"b\", y: \"a\" | \"b\") { switch (x) { case \"a\": let unrelated = 0; x = y; if (x === \"b\") {} break; default: break; } }");
});

test("switch-default-fallthrough", () => {
  evaluated("function f(x: uint8 | string | boolean) { switch (true) { case x is uint8: 0; default: if (x is uint8) {} break; } }");
});

test("nullish-right-live", () => {
  evaluated("function f(x: uint8 | null, y: uint8 | string) { return x ?? (y is uint8 ? 1 : 2); }");
});

test("optional-argument-live", () => {
  evaluated("function f(cb: ((x: number) => number) | null, x: uint8 | string) { return cb?.(x is uint8 ? 1 : 2); }");
});

test("assert-conditional", () => {
  evaluated("function makeAssert() { return Reflect.makeType({ kind: \"function\", signatures: [{ parameters: [{ name: \"v\", type: type any }], narrows: [{ target: \"v\", type: type uint8 }] }] }); } type A = makeAssert(); const assertU8: A = (v) => {}; function f(b: boolean, x: uint8 | string) { if (b) assertU8(x); if (x is string) {} }");
});

test("assert-conditional-braced", () => {
  evaluated("function makeAssert() { return Reflect.makeType({ kind: \"function\", signatures: [{ parameters: [{ name: \"v\", type: type any }], narrows: [{ target: \"v\", type: type uint8 }] }] }); } type A = makeAssert(); const assertU8: A = (v) => {}; function f(b: boolean, x: uint8 | string) { if (b) { assertU8(x); } if (x is string) {} }");
});

test("assert-write", () => {
  evaluated("function makeAssert() { return Reflect.makeType({ kind: \"function\", signatures: [{ parameters: [{ name: \"v\", type: type any }], narrows: [{ target: \"v\", type: type uint8 }] }] }); } type A = makeAssert(); const assertU8: A = (v) => {}; function f(x: uint8 | string, y: uint8 | string) { assertU8(x); x = y; if (x is string) {} }");
});

test("control-nested", () => {
  expectStaticTypeError("function f(x: uint8 | string) { if (x is uint8) { if (x is string) {} } }");
});

test("assert-control", () => {
  expectStaticTypeError("function makeAssert() { return Reflect.makeType({ kind: \"function\", signatures: [{ parameters: [{ name: \"v\", type: type any }], narrows: [{ target: \"v\", type: type uint8 }] }] }); } type A = makeAssert(); const assertU8: A = (v) => {}; function f(x: uint8 | string) { assertU8(x); if (x is string) {} }");
});

test("match-guard", () => {
  expectStaticTypeError("function f(x: uint8 | string, y: uint8 | string) { return match (x) { when uint8 if (y is uint8): y is string ? 1 : 2; default: 3; }; }");
});

test("forof-continue", () => {
  expectStaticTypeError("function f(xs: [].<uint8 | string>) { for (const x of xs) { if (x is string) continue; if (x is string) {} } }");
});

test("forin-guard", () => {
  expectStaticTypeError("function f(o: { a: uint8 }, x: uint8 | string) { for (const k in o) { if (x is string) continue; if (x is string) {} } }");
});

test("switch-lexical-baseline", () => {
  expectStaticTypeError("function f(x: \"a\" | \"b\") { switch (x) { case \"a\": if (x === \"b\") {} break; default: break; } }");
});

test("direct-guard-baseline", () => {
  expectStaticTypeError("function f(x: uint8 | string) { if (x is string) return; if (x is string) {} }");
});

test("forawait-continue-baseline", () => {
  expectStaticTypeError("async function f(xs: [].<uint8 | string>) { for await (const x of xs) { if (x is string) continue; if (x is string) {} } }");
});

const assertion = 'function makeAssert() { return Reflect.makeType({kind:"function", signatures:[{'
  + 'parameters:[{name:"v",type:type any}], narrows:[{target:"v",type:type uint8}]}]}); } '
  + 'type Assert = makeAssert(); const assertU8:Assert = (v)=>{}; ';

for (const [name, source] of [
  ['compound guard after nested return', 'function f(x:uint8|string,y:uint8|string){if(!(x is uint8 && y is uint8)){return;} if(y is string){}}'],
  ['both conditional alternatives narrow the same subject', 'function f(b:boolean,x:uint8|string){if(b ? x is uint8 : !(x is string)){if(x is string){}}}'],
  ['labeled continue reaches the outer update', 'function f(x:uint8|string){outer: for(;;x is string ? 1:2){if(x is string)return;while(true){continue outer;}}}'],
  ['continue reaches a do condition', 'function f(x:uint8|string){do{if(x is string)return;continue;}while(x is string);}'],
  ['nested break does not escape the enclosing while', 'function f(x:uint8|string){while(x is uint8){while(true){break;}} if(x is uint8){}}'],
  ['finalizer preserves a continue fact', 'function f(x:uint8|string){for(;;x is string ? 1:2){try{if(x is string)return;continue;}finally{}}}'],
  ['finalizer return overrides a break', 'function f(x:uint8|string){while(x is uint8){try{break;}finally{return;}}if(x is uint8){}}'],
  ['normal finalizer guard narrows the successor', 'function f(x:uint8|string){try{}finally{if(x is string)return;}if(x is string){}}'],
  ['boolean false default subtracts later labels', 'function f(x:uint8|string|boolean){switch(false){default:if(x is string){}break;case x is uint8:break;}}'],
  ['compound boolean label facts reach its body', 'function f(x:uint8|string,y:uint8|string){switch(true){case x is uint8 && y is uint8:if(y is string){}break;default:break;}}'],
  ['typeof fallthrough joins numeric families', 'function f(x:uint8|string|boolean){switch(typeof x){case "number":case "string":if(x is boolean){}break;default:break;}}'],
  ['nullish assignment narrows its reached operand', 'function f(x:uint8|null){x ??= (x===null ? 1:2);}'],
  ['logical and assignment narrows its reached operand', 'function f(x:{v:number}|null){x &&= (x===null ? {v:1}:{v:2});}'],
  ['logical or assignment narrows its reached operand', 'function f(x:{v:number}|null){x ||= (x===null ? {v:1}:{v:2});}'],
  ['assertion in a conditional arm stays local', assertion+'function f(b:boolean,x:uint8|string){b ? (assertU8(x),x is string ?1:2):0;}'],
  ['assertions on both branches dominate the join', assertion+'function f(b:boolean,x:uint8|string){if(b)assertU8(x);else assertU8(x);if(x is string){}}'],
  ['nested block assertion reaches the successor', assertion+'function f(x:uint8|string){{assertU8(x);}if(x is string){}}'],
  ['compound match guard reaches its body', 'function f(x:uint8|string,y:uint8|string){return match(x){when let value if (x is uint8 && y is uint8): {if(y is string){} 1;} default:0;};}'],
]) test(name, () => expectStaticTypeError(source));

for (const [name, source] of [
  ['alternative logical subjects do not imply either one', 'function f(x:uint8|string,y:uint8|string){if(x is uint8 || y is uint8){if(y is string){}}}'],
  ['right operand mutation invalidates an earlier test', 'function f(x:uint8|string,y:uint8|string,b:boolean){if(x is uint8 && ((x=y),b)){if(x is string){}}}'],
  ['comma prefix mutation is evaluated before its result', 'function f(x:uint8|string,y:uint8|string){if(x is uint8){if((x=y,x is string)){}}}'],
  ['continue and normal body paths join at the update', 'function f(b:boolean,x:uint8|string){for(;;x is string ?1:2){if(b)continue;if(x is string)return;}}'],
  ['finalizer mutation invalidates a continue fact', 'function f(x:uint8|string,y:uint8|string){for(;;x is string ?1:2){try{if(x is string)return;continue;}finally{x=y;}}}'],
  ['finalizer break overrides a return', 'function f(x:uint8|string){while(x is uint8){try{return;}finally{break;}}if(x is uint8){}}'],
  ['handler normal completion joins the try body', 'function f(x:uint8|string){try{if(x is string)return;}catch{}if(x is string){}}'],
  ['iteration may execute zero times', 'function f(xs:[].<uint8>,x:uint8|string){for(const v of xs){if(x is string)return;}if(x is string){}}'],
  ['switch case lexical binding shadows the subject', 'function f(x:"a"|"b"){switch(x){case "a":let x:"a"|"b"="b";if(x==="a"){}break;default:break;}}'],
  ['switch selection observes label mutation', 'function f(x:"a"|"b",y:"a"|"b"){switch(x){case (x=y,"a"):if(x==="b"){}break;default:break;}}'],
  ['later boolean labels can invalidate earlier failed facts', 'function f(x:uint8|string,y:uint8|string,b:boolean){switch(true){default:if(x is uint8){}break;case x is uint8:break;case (x=y,b):break;}}'],
  ['boolean fallthrough includes a selected case', 'function f(x:uint8|string){switch(false){case x is uint8:default:if(x is string){}break;}}'],
  ['optional argument mutation invalidates the binding presence fact', 'function f(cb:((a:any,b:number)=>number)|null,other:((a:any,b:number)=>number)|null){return cb?.((cb=other),cb===null ?1:2);}'],
  ['optional argument call can invalidate the binding', 'function f(cb:((a:any,b:number)=>number)|null){function clear(){cb=null;}return cb?.(clear(),cb===null ?1:2);}'],
  ['optional call does not narrow following code', 'function f(cb:((x:number)=>number)|null){cb?.(1);if(cb===null){}}'],
  ['short circuit assertion does not dominate its successor', assertion+'function f(b:boolean,x:uint8|string){b && assertU8(x);if(x is string){}}'],
  ['conditional assertion does not dominate its successor', assertion+'function f(b:boolean,x:uint8|string){b ? assertU8(x):0;if(x is string){}}'],
  ['checking a closure does not execute its assertion', assertion+'function f(x:uint8|string){const g=()=>{assertU8(x);};if(x is string){}}'],
  ['a value position may ask an impossible membership question', 'function f(x:uint8){return x is string;}'],
]) test(name, () => {
  evaluated(source);
});

for (const [name, source] of [
  ['compound test types a returned conditional arm', 'function f(x:uint8|string,y:uint8|string):uint8{return x is uint8 && y is uint8 ? y : uint8(0);}'],
  ['comma result types a returned conditional arm', 'function f(x:uint8|string):uint8{return (0,x is uint8) ? x : uint8(0);}'],
  ['conditional result types a returned conditional arm', 'function f(b:boolean,x:uint8|string):uint8{return (b ? x is uint8 : x is uint8) ? x : uint8(0);}'],
  ['compound test types discarded arithmetic', 'function f(x:uint8|string,y:uint8|string){(x is uint8 && y is uint8) ? (y * 2) : 0;}'],
  ['RHS assertion does not survive a store to its subject', assertion+'function f(x:uint8|string,y:uint8|string){x=(assertU8(x),y);if(x is string){}}'],
]) test(name, () => {
  evaluated(source);
});

for (const [name, source] of [
  ['predicate target changed by a later argument', 'function guard(v:any,unused:any):v is uint8{return true;} function f(x:uint8|string,y:uint8|string){if(guard(x,x=y)){if(x is string){}}}'],
  ['assertion target changed by a later argument', 'function makeAssert(){return Reflect.makeType({kind:"function",signatures:[{parameters:[{name:"v",type:type any},{name:"other",type:type any}],narrows:[{target:"v",type:type uint8}]}]});} type A=makeAssert();const assertU8:A=(v,other)=>{};function f(x:uint8|string,y:uint8|string){assertU8(x,x=y);if(x is string){}}'],
]) test(name, () => {
  evaluated(source);
});
