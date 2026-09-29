import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion } from '#self';

// #sec-proved-library-operations

test("rejects const m: Map.<uint8, [].<string>> = Map.groupBy(Composite.<[string]>([\"s\"]), (v: string): strin", () => {
  expectStaticTypeError("const m: Map.<uint8, [].<string>> = Map.groupBy(Composite.<[string]>([\"s\"]), (v: string): string => v);");
});

test("rejects const m: {[k: string]: [].<uint8>} = Object.groupBy(Composite.<[string]>([\"s\"]), (v: string): s", () => {
  expectStaticTypeError("const m: {[k: string]: [].<uint8>} = Object.groupBy(Composite.<[string]>([\"s\"]), (v: string): string => v);");
});

test("rejects const m: Map.<string, [].<uint8>> = Map.groupBy(Composite.<[string]>([\"s\"]), (v: string): strin", () => {
  expectStaticTypeError("const m: Map.<string, [].<uint8>> = Map.groupBy(Composite.<[string]>([\"s\"]), (v: string): string => v);");
});

test("rejects Map.groupBy(Composite.<[string]>([\"s\"]), (v: uint8): string => \"s\");", () => {
  expectStaticTypeError("Map.groupBy(Composite.<[string]>([\"s\"]), (v: uint8): string => \"s\");");
});

test("accepts const m: Map.<string, [].<string>> = Map.groupBy(Composite.<[string]>([\"s\"]), (v: string): stri", () => {
  expect(ok("const m: Map.<string, [].<string>> = Map.groupBy(Composite.<[string]>([\"s\"]), (v: string): string => v);")).toBe(true);
});

test("accepts const m: {[k: string]: [].<string>} = Object.groupBy(Composite.<[string]>([\"s\"]), (v: string): ", () => {
  expect(ok("const m: {[k: string]: [].<string>} = Object.groupBy(Composite.<[string]>([\"s\"]), (v: string): string => v);")).toBe(true);
});

test("accepts const m: {[k: string]: [].<string>} = Object.groupBy(Composite.<[string]>([\"s\"]), (v: string): ", () => {
  expect(ok("const m: {[k: string]: [].<string>} = Object.groupBy(Composite.<[string]>([\"s\"]), (v: string): uint8 => 1);")).toBe(true);
});

test("preserves a replacement for const m: Map.<uint8, [].<string>> = Map.groupBy(Composite.<[string]>([\"s\"]), (v: string): ", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("Map.groupBy = function () { return new Map([[1, [\"s\"]]]); };")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("const m: Map.<uint8, [].<string>> = Map.groupBy(Composite.<[string]>([\"s\"]), (v: string): string => v);")).Type).toBe('normal');
});

test("accepts const m: Map.<uint8, [].<string>> = Map.groupBy([], (v: string): string => v);", () => {
  expect(ok("const m: Map.<uint8, [].<string>> = Map.groupBy([], (v: string): string => v);")).toBe(true);
});
