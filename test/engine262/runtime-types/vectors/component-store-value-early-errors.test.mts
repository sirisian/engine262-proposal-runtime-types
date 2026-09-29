import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("union x unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.x=\"bad\";}");
});

test("union x executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.x=\"bad\";}f(float32x4(1,2,3,4));");
});

test("union xy unused", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xy=\"bad\";}");
});

test("union xy executed", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xy=\"bad\";}f(float32x4(1,2,3,4));");
});

test("computed [\"xy\"] unused", () => {
  expectStaticTypeError("function f(v:float32x4){v[\"xy\"]=\"bad\";}");
});

test("computed [\"xy\"] executed", () => {
  expectStaticTypeError("function f(v:float32x4){v[\"xy\"]=\"bad\";}f(float32x4(1,2,3,4));");
});

test("computed [(\"x\")] unused", () => {
  expectStaticTypeError("function f(v:float32x4){v[(\"x\")]=\"bad\";}");
});

test("computed [(\"x\")] executed", () => {
  expectStaticTypeError("function f(v:float32x4){v[(\"x\")]=\"bad\";}f(float32x4(1,2,3,4));");
});

test("numeric lane unused", () => {
  expectStaticTypeError("function f(v:float32x4,i:uint32){v[i]=\"bad\";}");
});

test("numeric lane executed", () => {
  expectStaticTypeError("function f(v:float32x4,i:uint32){v[i]=\"bad\";}f(float32x4(1,2,3,4),uint32(0));");
});

test("constant key unused", () => {
  expectStaticTypeError("const k=\"xy\";function f(v:float32x4){v[k]=\"bad\";}");
});

test("constant key executed", () => {
  expectStaticTypeError("const k=\"xy\";function f(v:float32x4){v[k]=\"bad\";}f(float32x4(1,2,3,4));");
});

test("valid union lane literal", () => {
  expect(ok("function f(v:float32x4|int32x4){v.x=1;}f(float32x4(1,2,3,4));")).toBe(true);
});

test("valid computed swizzle", () => {
  expect(ok("function f(v:float32x4){v[\"xy\"]=v.yx;}f(float32x4(1,2,3,4));")).toBe(true);
});

test("valid numeric lane", () => {
  expect(ok("function f(v:float32x4,i:uint32){v[i]=1;}f(float32x4(1,2,3,4),uint32(0));")).toBe(true);
});

test("ordinary object spelling", () => {
  expect(ok("function f(v:{xy:string}){v[\"xy\"]=\"ok\";}f({xy:\"\"});")).toBe(true);
});

test("unknown String key", () => {
  expect(ok("function f(v:float32x4,k:string){v[k]=\"bad\";}")).toBe(true);
});

test("any boundary", () => {
  expectThrownKind("function f(v:any){v.xy=\"bad\";}f(float32x4(1,2,3,4));", "TypeError");
});

test("existing single dot check", () => {
  expectStaticTypeError("function f(v:float32x4){v.xy=\"bad\";}");
});

test("existing duplicate permission", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xx=v.xy;}");
});

test("numeric bounds intentionally dynamic", () => {
  expectThrownKind("function f(v:float32x4,i:uint32){return v[i];}f(float32x4(1,2,3,4),uint32(4));", "RangeError");
});

test("destructured scalar union target", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){[v.x]=[\"bad\"];}");
});

test("destructured computed swizzle", () => {
  expectStaticTypeError("function f(v:float32x4){({v:v[\"xy\"]}={v:\"bad\"});}");
});

test("iteration scalar union target", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){for(v.x of [\"bad\"]) {}}");
});

test("computed logical write", () => {
  expectStaticTypeError("function f(v:float32x4){v[\"x\"] ||= \"bad\";}");
});

test("computed compound write", () => {
  expectStaticTypeError("function f(v:float32x4){v[\"x\"] += \"bad\";}");
});

test("union swizzle compound write", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4){v.xy += \"bad\";}");
});

test("numeric computed destructuring", () => {
  expectStaticTypeError("function f(v:float32x4,i:uint32){[v[i]]=[\"bad\"];}");
});

test("any key retains runtime", () => {
  expectThrownKind("function f(v:float32x4,k:any){v[k]=\"bad\";}f(float32x4(1,2,3,4),\"xy\");", "TypeError");
});

test("computed writes update selected lanes", () => {
  expect(evaluated("let v:float32x4=float32x4(1,2,3,4);v[\"xy\"]=v.yx;function f(v:float32x4,i:uint32){v[i]=9;return v;}v=f(v,uint32(2));String(v.x)+\",\"+String(v.y)+\",\"+String(v.z);")).toBe("2,1,9");
});

test("mixed vector and ordinary member destinations", () => {
  expectStaticTypeError("function f(v:float32x4|{x:string}){v.x=Symbol();}");
});

test("value literal is checked per vector arm", () => {
  expect(evaluated("function f(v:float32x4|int32x4){v.x=1;return v;}const v:any=f(int32x4(0,0,0,0));String(v.x);")).toBe("1");
});

test("vector passes an any boundary", () => {
  expect(evaluated("const v:any=float32x4(1,2,3,4);String(v.x)+\",\"+String(v.y);")).toBe("1,2");
});

test("vector satisfies its union member", () => {
  expect(evaluated("function f(v:float32x4|int32x4){return v;}const v:float32x4|int32x4=f(int32x4(1,2,3,4));String(v.x);")).toBe("1");
});

test("vector wrong shape still fails dynamically", () => {
  expectThrownKind("const v:any=int32x4(1,2,3,4);const wrong:float32x4=v;", "TypeError");
});

test("computed self swizzle keeps correlation", () => {
  expect(evaluated("function f(v:float32x4|int32x4){v[\"xy\"]=v[\"yx\"];return String(v.x)+\",\"+String(v.y);}f(int32x4(1,2,3,4));")).toBe("2,1");
});

test("independent vector receivers are not correlated", () => {
  expectStaticTypeError("function f(v:float32x4|int32x4,w:float32x4|int32x4){v.xy=w.yx;}");
});

test("typed numeric lane update", () => {
  expect(evaluated("let v:float32x4=float32x4(1,2,3,4);function f(v:float32x4,i:uint32){v[i]++;return v;}v=f(v,uint32(0));String(v.x);")).toBe("2");
});


test('vector membership honors any and union targets without accepting a different vector type', () => {
  expect(evaluated('const v: any = int32x4(1,2,3,4); String(v is (float32x4 | int32x4));')).toBe('true');
  expect(evaluated('const v: any = int32x4(1,2,3,4); String(v is any);')).toBe('true');
  expect(evaluated('const v: any = int32x4(1,2,3,4); String(v is float32x4);')).toBe('false');
});
