import { expect, test } from 'vitest';
import { evaluated, evaluatedSequence, expectEarlyError, expectThrown } from '../harness.mts';

test("proven array with calls check their replacement destination", () => {
  expectEarlyError("const a: [].<uint8> = [1]; a.with(0, \"bad\");", "StaticTypeError");
  expectEarlyError("const a: [uint8, string] = [1, \"s\"]; a.with(0, \"bad\");", "StaticTypeError");
  expectEarlyError("const a: [uint8, string] = [1, \"s\"]; a.with(-1, 2);", "StaticTypeError");
});

test("proven comparators and reducers must accept their actual arguments", () => {
  expectEarlyError("const a: [].<uint8> = [2,1]; a.sort(1);", "StaticTypeError");
  expectEarlyError("const a: [].<uint8> = [2,1]; a.toSorted((x: string, y: string): number => 0);", "StaticTypeError");
  expectEarlyError("const a: [].<uint8> = [2,1]; a.reduce(1, 0);", "StaticTypeError");
  expectEarlyError("const a: [].<uint8> = [2,1]; a.reduceRight((acc: string, x: string): string => acc, \"s\");", "StaticTypeError");
});

test("fresh copies have dynamic storage extent", () => {
  expectEarlyError("const a: [2].<uint8> = [1,2]; const b: [2].<uint8> = a.slice(0,1);", "StaticTypeError");
  expectEarlyError("const a: [2].<uint8> = [1,2]; const b: [2].<uint8> = a.filter(x => false);", "StaticTypeError");
  expectEarlyError("const a: [2].<uint8> = [1,2]; const b: [2].<uint8> = a.toReversed();", "StaticTypeError");
});

test("copy boundaries accept the created dynamic container", () => {
  expect(evaluated("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.slice(0,1);; \"ok\";")).toBe("ok");
  expect(evaluated("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.filter(x => true);; \"ok\";")).toBe("ok");
  expect(evaluated("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.toSorted();; \"ok\";")).toBe("ok");
});

test("tuple positions negative indices and distinct accumulator types work", () => {
  expect(evaluated("const a: [uint8, string] = [1, \"s\"]; a.with(-1, \"ok\");; \"ok\";")).toBe("ok");
  expect(evaluated("const a: [].<uint8> = [2,1]; a.sort((x: uint8, y: uint8): string => \"0\");; \"ok\";")).toBe("ok");
  expect(evaluated("const a: [].<uint8> = [2,1]; a.reduce((acc: string, x: uint8): string => acc, \"s\");; \"ok\";")).toBe("ok");
  expect(evaluated("const a = [1,2]; a.with(0, \"s\");; \"ok\";")).toBe("ok");
});

test("own methods prototype replacement and unknown effects defeat the proof", () => {
  expect(evaluated("let a:[].<uint8>=[1];a.with=(i:number,x:string):string=>x;a.with(0,\"own\");; \"ok\";")).toBe("ok");
  expect(evaluated("let a:[].<uint8>=[1];a.sort=(x:uint8):string=>\"own\";a.sort(1);; \"ok\";")).toBe("ok");
  expect(evaluated("let a:[2].<uint8>=[1,2];a.slice=():[2].<uint8>=>[1,2];String(a.slice().length);; \"ok\";")).toBe("ok");
  expect(evaluated("Array.prototype.with = function(i, x) { return x; }; const a: [].<uint8> = [1]; a.with(0, \"own\");; \"ok\";")).toBe("ok");
  expect(evaluated("const a: [].<uint8> = [1]; function change() { a.with = (i:number, x:string):string => x; } change(); a.with(0,\"own\");; \"ok\";")).toBe("ok");
  expect(evaluated("function f(a: [].<uint8>, value: any) { a.with(0, value); }; \"ok\";")).toBe("ok");
});

test('a previous script can replace the intrinsic before checking', () => {
  expect(evaluatedSequence(['Array.prototype.with = function(i,x) { return x; }; "changed";', 'const a: [].<uint8> = [1]; a.with(0, "own");'])).toBe('own');
});

test('replaced or shadowed String calls can invalidate an array dependency', () => {
  const replacement = 'function replaceArray() { Array.prototype.with = function(i,x) { return x; }; }';
  expect(evaluatedSequence([replacement, 'String = replaceArray; String(1); const a: [].<uint8> = [1]; a.with(0, "own");'])).toBe('own');
  expect(evaluatedSequence([replacement, 'globalThis.String = replaceArray; String(1); const a: [].<uint8> = [1]; a.with(0, "own");'])).toBe('own');
  expect(evaluatedSequence([`${replacement} let String = replaceArray;`, 'String(1); const a: [].<uint8> = [1]; a.with(0, "own");'])).toBe('own');
});

test('copy storage is enforced at an erased receiving boundary', () => {
  expectThrown('const a: [2].<uint8> = [1,2]; const b:any=a.slice(); const c:[2].<uint8>=b;');
});

test('index coercion is retained and tuple fractional indices truncate', () => {
  expect(evaluated('const a: [uint8,string] = [1,"s"]; a.with("1","ok"); "ok";')).toBe('ok');
  expect(evaluated('const a: [].<uint8> = [1]; a.with("0", 2); "ok";')).toBe('ok');
  expectEarlyError('const a: [uint8,string] = [1,"s"]; a.with(0.8,"bad");', 'StaticTypeError');
});

test('concat joins element types in its dynamic result', () => {
  expect(evaluated('const a: [2].<uint8> = [1,2]; const b: [].<uint8|string> = a.concat(["s"]); "ok";')).toBe('ok');
});
