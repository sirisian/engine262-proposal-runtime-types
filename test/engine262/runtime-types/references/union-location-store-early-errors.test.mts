import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("R52: direct unused", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){g()=\"bad\";}");
});

test("R52: direct executed", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){g()=\"bad\";}f(a);");
});

test("R52: grouped unused", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){(g())=\"bad\";}");
});

test("R52: grouped executed", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){(g())=\"bad\";}f(a);");
});

test("R52: destructuring unused", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){[g()]=[\"bad\"];}");
});

test("R52: destructuring executed", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){[g()]=[\"bad\"];}f(a);");
});

test("R52: alias unused", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){let ref r=g();r=\"bad\";}");
});

test("R52: alias executed", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){let ref r=g();r=\"bad\";}f(a);");
});

test("R52: same program happens to select writable String arm", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){g()=\"bad\";}f(b);");
});

test("R52: same referent type alternatives", () => {
  expect(ok("let n:uint8=1;function a():ref uint8{return ref n;}function f(g:(()=>ref uint8)|((x?:number)=>ref uint8)){g()=2;}f(a);")).toBe(true);
});

test("R52: actual union-typed location", () => {
  expect(ok("type Either=uint8|string;let n:Either=uint8(1);function a():ref Either{return ref n;}function f(g:()=>ref Either){g()=\"ok\";}f(a);")).toBe(true);
});

test("R52: reads join referent types", () => {
  expect(ok("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){const value:uint8|string=g();}f(a);f(b);")).toBe(true);
});

test("R52: dynamic callee retains runtime", () => {
  expectThrownKind("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:any){g()=\"bad\";}f(a);", "TypeError");
});

test("R52: existing all arms bad", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:(()=>ref uint8)|(()=>ref uint16)){g()=\"bad\";}");
});

test("R52: existing single ref check", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(){a()=\"bad\";}");
});

test("R52: existing mixed location eligibility", () => {
  expectStaticTypeError("function f(g:(()=>ref uint8)|(()=>number)){g()=2;}");
});

test("R52: same reference union no write", () => {
  expect(ok("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:( (()=>ref uint8) | (()=>ref string) )){g();}f(a);")).toBe(true);
});

test("R52: logical call store", () => {
  expectStaticTypeError("function f(g:(()=>ref uint8)|(()=>ref string)){g() ||= \"bad\";}");
});

test("R52: logical alias store", () => {
  expectStaticTypeError("function f(g:(()=>ref uint8)|(()=>ref string)){let ref p=g();p ||= \"bad\";}");
});

test("R52: iteration call store", () => {
  expectStaticTypeError("function f(g:(()=>ref uint8)|(()=>ref string)){for(g() of [\"bad\"]){}}");
});

test("R52: iteration alias store", () => {
  expectStaticTypeError("function f(g:(()=>ref uint8)|(()=>ref string)){let ref p=g();for(p of [\"bad\"]){}}");
});

test("R52: alias chain retains all destinations", () => {
  expectStaticTypeError("function f(g:(()=>ref uint8)|(()=>ref string)){let ref p=g();const ref q=p;q=\"bad\";}");
});

test("R52: stable captured alias retains destinations", () => {
  expectStaticTypeError("function f(g:(()=>ref uint8)|(()=>ref string)){let ref p=g();const write=()=>{p=\"bad\";};}");
});

test("R52: rebinding introduces heterogeneous destinations", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:(()=>ref uint8)|(()=>ref string)){let u:uint8|string=\"\";let ref p=u;ref p=g();p=\"bad\";}");
});

test("R52: branch retains rejecting destination", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:(()=>ref uint8)|(()=>ref string),c:boolean){let ref p=g();if(c){ref p=s;}p=\"bad\";}");
});

test("R52: loop back edge retains rejecting destination", () => {
  expectStaticTypeError("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:(()=>ref uint8)|(()=>ref string),c:boolean){let u:uint8|string=\"\";let ref p=u;while(c){p=\"bad\";ref p=g();}}");
});

test("R52: rebinding updates alias chains", () => {
  expect(evaluated("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:(()=>ref uint8)|(()=>ref string)){let ref p=g();let ref q=p;ref p=s;q=\"ok\";}f(a);s;")).toBe("ok");
});

test("R52: both branches replace destinations", () => {
  expect(evaluated("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:(()=>ref uint8)|(()=>ref string),c:boolean){let ref p=g();if(c){ref p=s;}else{ref p=s;}p=\"ok\";}f(a,true);s;")).toBe("ok");
});

test("R52: abrupt invalid branch is not a later destination", () => {
  expect(ok("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:(()=>ref uint8)|(()=>ref string),c:boolean){let u:uint8|string=\"\";let ref p=u;if(c){ref p=g();return;}p=\"ok\";}f(a,false);")).toBe(true);
});

test("R52: captured rebinding invalidates source destinations", () => {
  expect(evaluated("let n:uint8=1;function a():ref uint8{return ref n;}let s:string=\"\";function b():ref string{return ref s;}function f(g:(()=>ref uint8)|(()=>ref string)){let ref p=g();function redirect(){ref p=s;}redirect();p=\"ok\";}f(a);s;")).toBe("ok");
});

test("R52: shadowing preserves lexical identity", () => {
  expect(ok("function f(g:(()=>ref uint8)|(()=>ref string)){let ref p=g();{let p:string=\"\";p=\"ok\";}}")).toBe(true);
});

test("R52: numeric literals use each destination context", () => {
  expect(evaluated("let a:uint8=1;let b:uint16=1;function x():ref uint8{return ref a;}function y():ref uint16{return ref b;}function f(g:(()=>ref uint8)|(()=>ref uint16)){let ref p=g();p=2;}f(x);f(y);String(a)+\",\"+String(b);")).toBe("2,2");
});

test("R52: literal exceeds one destination", () => {
  expectStaticTypeError("function f(g:(()=>ref uint8)|(()=>ref uint16)){let ref p=g();p=300;}");
});

test("R52: fresh object uses each destination context", () => {
  expect(evaluated("type A={x:uint8};type B={x:uint16};let a:A={x:1};let b:B={x:1};function x():ref A{return ref a;}function y():ref B{return ref b;}function f(g:(()=>ref A)|(()=>ref B)){let ref p=g();p={x:2};}f(x);f(y);String(a.x)+\",\"+String(b.x);")).toBe("2,2");
});

test("R52: fresh object exceeds one destination", () => {
  expectStaticTypeError("function f(g:(()=>ref {x:uint8})|(()=>ref {x:uint16})){let ref p=g();p={x:300};}");
});

test("R52: member borrow preserves destination alternatives", () => {
  expectStaticTypeError("function f(o:{x:uint8}|{x:string}){let ref p=o.x;p=\"bad\";}");
});

test("R52: single union target stays one obligation", () => {
  expect(evaluated("type U=uint8|string;let n:U=uint8(1);function g():ref U{return ref n;}let ref p=g();p=\"ok\";n;")).toBe("ok");
});

test("R52: updates retain incompatible write target", () => {
  expectStaticTypeError("function f(g:(()=>ref number)|(()=>ref boolean)){let ref p=g();p++;}");
});

test("R52: contextual union-call callback retains alias destinations", () => {
  expectStaticTypeError("type G=(()=>ref uint8)|(()=>ref string);function f(use:((cb:(g:G)=>void)=>void)|((cb:(g:G)=>void,n?:number)=>void)){use(g=>{let ref p=g();p=\"bad\";});}");
});

test("R52: contextual union-call alternatives stay separate", () => {
  expect(ok("function f(use:((cb:(g:()=>ref uint8,x:uint8)=>void)=>void)|((cb:(g:()=>ref string,x:string)=>void,n?:number)=>void)){use((g,x)=>{let ref p=g();p=x;});}")).toBe(true);
});

test("R52: direct contextual callback alias", () => {
  expectStaticTypeError("type G=(()=>ref uint8)|(()=>ref string);function use(cb:(g:G)=>void):void{}use(g=>{let ref p=g();p=\"bad\";});");
});

test("R52: numeric compound stores preserve actual values", () => {
  expect(evaluated("let a:uint8=1;let b:uint16=1;function x():ref uint8{return ref a;}function y():ref uint16{return ref b;}function f(g:(()=>ref uint8)|(()=>ref uint16)){let ref p=g();p+=1;}f(x);f(y);String(a)+\",\"+String(b);")).toBe("2,2");
});

test("R52: rebinding redirects alias in RHS", () => {
  expect(evaluated("let n:uint8=1;let s:string=\"\";function a():ref uint8{return ref n;}function f(g:(()=>ref uint8)|(()=>ref string)){let ref p=g();function redirect(){ref p=s;return \"ok\";}p=redirect();}f(a);s;")).toBe("ok");
});
