import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion } from '#self';

// #sec-proved-library-operations

test("rejects const s: string = \"x\"; s.replace(\"x\", (match: uint8): string => \"s\");", () => {
  expectStaticTypeError("const s: string = \"x\"; s.replace(\"x\", (match: uint8): string => \"s\");");
});

test("rejects const s: string = \"xx\"; s.replaceAll(\"x\", (match: uint8): string => \"s\");", () => {
  expectStaticTypeError("const s: string = \"xx\"; s.replaceAll(\"x\", (match: uint8): string => \"s\");");
});

test("rejects const s: string = \"x\"; s.replace(\"x\", (match: string, offset: uint64, whole: string, extra: uin", () => {
  expectStaticTypeError("const s: string = \"x\"; s.replace(\"x\", (match: string, offset: uint64, whole: string, extra: uint8): string => match);");
});

test("accepts const s: string = \"x\"; s.replace(\"x\", (match: string, offset: uint64, whole: string): string =>", () => {
  expect(ok("const s: string = \"x\"; s.replace(\"x\", (match: string, offset: uint64, whole: string): string => match);")).toBe(true);
});

test("accepts const s: string = \"x\"; s.replace(\"z\", (match: uint8): string => \"s\");", () => {
  expect(ok("const s: string = \"x\"; s.replace(\"z\", (match: uint8): string => \"s\");")).toBe(true);
});

test("preserves a replacement for const s: string = \"x\"; s.replace(\"x\", (match: uint8): string => \"s\");", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("String.prototype.replace = function () { return \"ok\"; };")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("const s: string = \"x\"; s.replace(\"x\", (match: uint8): string => \"s\");")).Type).toBe('normal');
});

test("accepts const s: string = \"x\"; s.replace({[Symbol.replace]() {return \"ok\";}}, (match: uint8): string =>", () => {
  expect(ok("const s: string = \"x\"; s.replace({[Symbol.replace]() {return \"ok\";}}, (match: uint8): string => \"s\");")).toBe(true);
});

test("accepts function f(s: string, search: any) { return s.replace(search, (match: uint8): string => \"s\"); }", () => {
  expect(ok("function f(s: string, search: any) { return s.replace(search, (match: uint8): string => \"s\"); }")).toBe(true);
});
