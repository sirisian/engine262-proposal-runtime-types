import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("R49: xx unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx=v.xy;}");
});

test("R49: xx executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx=v.xy;}const v:float32x4=(1,2,3,4);f(v);");
});

test("R49: rr unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.rr=v.rg;}");
});

test("R49: rr executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.rr=v.rg;}const v:float32x4=(1,2,3,4);f(v);");
});

test("R49: xyx unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xyx=v.xyz;}");
});

test("R49: xyx executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xyx=v.xyz;}const v:float32x4=(1,2,3,4);f(v);");
});

test("R49: xxxx unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xxxx=v.xyzw;}");
});

test("R49: xxxx executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xxxx=v.xyzw;}const v:float32x4=(1,2,3,4);f(v);");
});

test("R49: computed key unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v[\"xx\"]=v.xy;}");
});

test("R49: computed key executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v[\"xx\"]=v.xy;}const v:float32x4=(1,2,3,4);f(v);");
});

test("R49: compound unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx+=v.xy;}");
});

test("R49: compound executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx+=v.xy;}const v:float32x4=(1,2,3,4);f(v);");
});

test("R49: distinct lanes", () => {
  expect(ok("function f(v:float32x4|int32x4){v.xy=v.yx;}const v:float32x4=(1,2,3,4);f(v);")).toBe(true);
});

test("R49: repeated read", () => {
  expect(ok("function f(v:float32x4|int32x4){return v.xx;}const v:float32x4=(1,2,3,4);f(v);")).toBe(true);
});

test("R49: ordinary property", () => {
  expect(ok("function f(v:{xx:number}|{xx:number,y:number}){v.xx=3;}f({xx:1});")).toBe(true);
});

test("R49: unknown key", () => {
  expect(ok("function f(v:float32x4|int32x4,key:string){v[key]=v.xy;}")).toBe(true);
});

test("R49: narrowed valid", () => {
  expect(ok("function f(v:float32x4|int32x4){if(v is float32x4){v.xy=v.yx;}}const v:float32x4=(1,2,3,4);f(v);")).toBe(true);
});

test("R49: any retains runtime", () => {
  expectThrownKind("function f(v:any){v.xx=v.xy;}const v:float32x4=(1,2,3,4);f(v);", 'TypeError');
});

test("R49: existing single type check", () => {
  expectStaticTypeError("function f(v:float32x4){v.xx=v.xy;}");
});

test("R49: mixed receiver has forbidden arm", () => {
  expectStaticTypeError("function f(v:float32x4|{xx:any}){v.xx=1;}");
});

test("R49: const key repeat", () => {
  expectStaticTypeError("const key=\"rr\";function f(v:float32x4|int32x4){v[key]=v.xy;}");
});

test("R49: all valid receivers", () => {
  expect(ok("function f(v:float32x4|{xy:any}){v.xy=v.xy;}")).toBe(true);
});

test("R49: mixed read retains vector result", () => {
  expectStaticTypeError("function f(v:float32x4|{xy:vector.<float32,2>}){let n:boolean=v.xy;}");
});

test("R49: distinct lane write preserves lane order", () => {
  expect(evaluated("function swap(v:float32x4|int32x4){v.xy=v.yx;return String(v.x)+\",\"+String(v.y);}swap(float32x4(1,2,3,4));")).toBe("2,1");
});
