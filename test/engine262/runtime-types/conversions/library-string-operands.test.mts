import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion } from '#self';

// #sec-proved-library-operations

test("rejects const s: string = \"x\"; const search: symbol = Symbol(); s.includes(search);", () => {
  expectStaticTypeError("const s: string = \"x\"; const search: symbol = Symbol(); s.includes(search);");
});

test("rejects const a: [].<uint8> = [1]; const sep: symbol = Symbol(); a.join(sep);", () => {
  expectStaticTypeError("const a: [].<uint8> = [1]; const sep: symbol = Symbol(); a.join(sep);");
});

test("rejects const a: [].<uint8> = []; const sep: symbol = Symbol(); a.join(sep);", () => {
  expectStaticTypeError("const a: [].<uint8> = []; const sep: symbol = Symbol(); a.join(sep);");
});

test("rejects const s: symbol = Symbol(); `${s}`;", () => {
  expectStaticTypeError("const s: symbol = Symbol(); `${s}`;");
});

test("accepts const s: string = \"x\"; s.includes(\"x\");", () => {
  expect(ok("const s: string = \"x\"; s.includes(\"x\");")).toBe(true);
});

test("accepts const s: symbol = Symbol(); String(s);", () => {
  expect(ok("const s: symbol = Symbol(); String(s);")).toBe(true);
});

test("preserves a replacement for const s: string = \"x\"; const search: symbol = Symbol(); s.includes(search);", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("String.prototype.includes = function () { return true; };")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("const s: string = \"x\"; const search: symbol = Symbol(); s.includes(search);")).Type).toBe('normal');
});

test("preserves a replacement for const a: [].<uint8> = [1]; const sep: symbol = Symbol(); a.join(sep);", () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("Array.prototype.join = function () { return \"ok\"; };")).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger("const a: [].<uint8> = [1]; const sep: symbol = Symbol(); a.join(sep);")).Type).toBe('normal');
});

test("accepts function f(s: string, search: any) { return s.includes(search); }", () => {
  expect(ok("function f(s: string, search: any) { return s.includes(search); }")).toBe(true);
});


test('an implicit structural conversion may replace the selected method', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('globalThis.input={get x(){String.prototype.includes=function(){return true;};return 1;}};')).Type).toBe('normal');
  expect(EnsureCompletion(realm.evaluateScriptSkipDebugger('const a:{readonly x:number}=input;const s:string="x";const k:symbol=Symbol();s.includes(k);')).Type).toBe('normal');
});
