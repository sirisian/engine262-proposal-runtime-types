import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

test("switch fall-through reaches the implicit return", () => {
  expectEarlyError("function f(x:boolean):uint8 {switch(x){case true:return 1;default:}}", "SyntaxError");
  expectEarlyError("function f(x:boolean):uint8 {switch(x){default:return 1;case true:}}", "SyntaxError");
});

test("a continue does not make a later return reachable", () => {
  expectEarlyError("function f():uint8{do{continue;return 1;}while(false)}", "SyntaxError");
  expectEarlyError("function f(): uint8 { outer: do { continue outer; return 1; } while(false); }", "SyntaxError");
});

test("break targets and finalizers preserve completion outcomes", () => {
  expectEarlyError("function f(): uint8 { done: { break done; return 1; } }", "SyntaxError");
  expectEarlyError("function f(): uint8 { do { try { return 1; } finally { continue; } } while(false); }", "SyntaxError");
  expectEarlyError('function f(xs: [].<uint8>): uint8 { outer: while (true) { for (const x of xs) { break outer; } } }', 'SyntaxError');
  expectEarlyError('async function f(xs: any): uint8 { outer: while (true) { for await (const x of xs) { break outer; } } }', 'SyntaxError');
});

test("grouped labels and a following return complete their functions", () => {
  expect(evaluated("function f(x:boolean):uint8 {switch(x){case true:default:return 1;}}String(f(false));; \"ok\";")).toBe("ok");
  expect(evaluated("function f(x: boolean): uint8 { switch(x) { case true: return 1; default: } return 2; }; \"ok\";")).toBe("ok");
  expect(evaluated("function f(): uint8 { done: { break done; } return 1; }; \"ok\";")).toBe("ok");
  expect(evaluated("function f(): uint8 { try { } finally { return 1; } }; \"ok\";")).toBe("ok");
  expect(evaluated("function f(): uint8 { outer: while(true) { while(true) { continue outer; } } }; \"ok\";")).toBe("ok");
});

test("async return promises include the same fall-off obligation", () => {
  expectEarlyError("async function f(x: boolean): uint8 { switch(x) { case true: return 1; default: } }", "SyntaxError");
});

test('loops that may perform no iterations retain an implicit return', () => {
  expectEarlyError('function f(xs: [].<uint8>): uint8 { for (const x of xs) { return x; } }', 'SyntaxError');
  expectEarlyError('function f(o: object): uint8 { for (const key in o) { return 1; } }', 'SyntaxError');
});

test('completion facts are also used for published return inference', () => {
  expect(evaluated('function f(x: boolean) { switch(x) { case true: default: return (1 := uint8); } } const n: uint8 = f(true); String(n);')).toBe('1');
  expectEarlyError('function f(x: boolean) { switch(x) { case true: return (1 := uint8); default: } } const n: uint8 = f(false);', 'StaticTypeError');
});
