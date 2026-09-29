import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("xx unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx=v.xy;}");
});

test("xx executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx=v.xy;}const v:float32x4=(1,2,3,4);f(v);");
});

test("rr unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.rr=v.rg;}");
});

test("rr executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.rr=v.rg;}const v:float32x4=(1,2,3,4);f(v);");
});

test("xyx unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xyx=v.xyz;}");
});

test("xyx executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xyx=v.xyz;}const v:float32x4=(1,2,3,4);f(v);");
});

test("xxxx unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xxxx=v.xyzw;}");
});

test("xxxx executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xxxx=v.xyzw;}const v:float32x4=(1,2,3,4);f(v);");
});

test("computed key unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v[\"xx\"]=v.xy;}");
});

test("computed key executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v[\"xx\"]=v.xy;}const v:float32x4=(1,2,3,4);f(v);");
});

test("compound unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx+=v.xy;}");
});

test("compound executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx+=v.xy;}const v:float32x4=(1,2,3,4);f(v);");
});

test("distinct lanes", () => {
  expect(ok("function f(v:float32x4|int32x4){v.xy=v.yx;}const v:float32x4=(1,2,3,4);f(v);")).toBe(true);
});

test("repeated read", () => {
  expect(ok("function f(v:float32x4|int32x4){return v.xx;}const v:float32x4=(1,2,3,4);f(v);")).toBe(true);
});

test("ordinary property", () => {
  expect(ok("function f(v:{xx:number}|{xx:number,y:number}){v.xx=3;}f({xx:1});")).toBe(true);
});

test("unknown key", () => {
  expect(ok("function f(v:float32x4|int32x4,key:string){v[key]=v.xy;}")).toBe(true);
});

test("narrowed valid", () => {
  expect(ok("function f(v:float32x4|int32x4){if(v is float32x4){v.xy=v.yx;}}const v:float32x4=(1,2,3,4);f(v);")).toBe(true);
});

test("any retains runtime", () => {
  expectThrownKind("function f(v:any){v.xx=v.xy;}const v:float32x4=(1,2,3,4);f(v);", 'TypeError');
});

test("existing single type check", () => {
  expectStaticTypeError("function f(v:float32x4){v.xx=v.xy;}");
});

test("mixed receiver has forbidden arm", () => {
  expectStaticTypeError("function f(v:float32x4|{xx:any}){v.xx=1;}");
});

test("const key repeat", () => {
  expectStaticTypeError("const key=\"rr\";function f(v:float32x4|int32x4){v[key]=v.xy;}");
});

test("all valid receivers", () => {
  expect(ok("function f(v:float32x4|{xy:any}){v.xy=v.xy;}")).toBe(true);
});

test("mixed read retains vector result", () => {
  expectStaticTypeError("function f(v:float32x4|{xy:vector.<float32,2>}){let n:boolean=v.xy;}");
});

test("distinct lane write preserves lane order", () => {
  expect(evaluated("function swap(v:float32x4|int32x4){v.xy=v.yx;return String(v.x)+\",\"+String(v.y);}swap(float32x4(1,2,3,4));")).toBe("2,1");
});
