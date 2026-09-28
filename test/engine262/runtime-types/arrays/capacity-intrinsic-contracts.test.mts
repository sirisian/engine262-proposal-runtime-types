import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, evaluatedSequence, ok } from '../harness.mts';

// #sec-array-type-withcapacity

test("rejects capacity bad run", () => {
  expectStaticTypeError("const a = [].<uint8>.withCapacity('bad');");
});

test("rejects capacity bad result top", () => {
  expectStaticTypeError("let a: [].<string> = [].<uint8>.withCapacity(4);");
});

test("accepts capacity mutated control", () => {
  expect(ok("[].<uint8>.withCapacity = (value: string): string => value; globalThis.__observation = [].<uint8>.withCapacity('ok');")).toBe(true);
});

test("accepts capacity good", () => {
  expect(ok("const a = [].<uint8>.withCapacity(4); globalThis.__observation = String(a.length);")).toBe(true);
});

test("accepts capacity uint64 control", () => {
  expect(ok("const count: uint64 = 4; const values = [].<uint8>.withCapacity(count); globalThis.__observation = String(values.length);")).toBe(true);
});

test("accepts capacity bad result", () => {
  expect(ok("function unused() { let a: [].<string> = [].<uint8>.withCapacity(4); }")).toBe(true);
});

test("later mutation before function invocation", () => {
  expect(ok("function f() { return [].<uint8>.withCapacity(\"ok\"); } [].<uint8>.withCapacity = (x: string): string => x; f();")).toBe(true);
});

test("unknown argument effects defer", () => {
  expectThrownKind("function f(): string { [].<uint8>.withCapacity = (x: string): string => x; return \"ok\"; } [].<uint8>.withCapacity(f());", 'TypeError');
});

test("extracted method retains dynamic boundary", () => {
  expect(ok("const reserve = [].<uint8>.withCapacity; reserve(4);")).toBe(true);
});

test("capacity count type is the index type", () => {
  expectStaticTypeError("const n: uint8 = 4; [].<uint8>.withCapacity(n);");
});

test("valid literal capacity call", () => {
  expect(ok("[].<uint8>.withCapacity(4);")).toBe(true);
});

test('prior script replacement defeats the intrinsic proof', () => {
  expect(evaluatedSequence([
    '[].<uint8>.withCapacity = (x: string): string => x;',
    '[].<uint8>.withCapacity("ok");',
  ])).toBe('ok');
});

test('prior script accessor replacement defeats the intrinsic proof', () => {
  expect(evaluatedSequence([
    'Object.defineProperty([].<uint8>, "withCapacity", { get() { return (x: string): string => x; } });',
    '[].<uint8>.withCapacity("ok");',
  ])).toBe('ok');
});
