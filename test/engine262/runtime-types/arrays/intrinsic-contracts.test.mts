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
  expectEarlyError("const a: [2].<uint8> = [1,2]; const b: [2].<uint8> = a.toSpliced(0, 1, 3);", "StaticTypeError");
});

// #sec-intrinsic-array-contracts: "`toSorted`, `toReversed` and `with` give as
// many elements as the receiver holds. On an array of fixed extent each gives a
// new array of that extent, whose type is the receiver's."
test("toSorted, toReversed and with keep a fixed extent", () => {
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const b: [3].<uint8> = a.toSorted(); b.join() + '|' + a.join();")).toBe("1,2,3|3,1,2");
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const b: [3].<uint8> = a.toReversed(); b.join() + '|' + a.join();")).toBe("2,1,3|3,1,2");
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const b: [3].<uint8> = a.with(0, 9); b.join() + '|' + a.join();")).toBe("9,1,2|3,1,2");
  expect(evaluated("let v: [3].<float32> = [3,1,2]; v = v.toSorted(); v.join();")).toBe("1,2,3");
  // The result is of the fixed type to the checker, and is a fixed array when it runs.
  expectEarlyError("const a: [3].<uint8> = [3,1,2]; const n: string = a.toSorted();", "StaticTypeError");
  expectEarlyError("const a: [3].<uint8> = [3,1,2]; const n: string = a.toReversed();", "StaticTypeError");
  expectEarlyError("const a: [3].<uint8> = [3,1,2]; const n: string = a.with(0, 1);", "StaticTypeError");
  expectEarlyError("const a: [3].<uint8> = [3,1,2]; const b: [2].<uint8> = a.toSorted();", "StaticTypeError");
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const b: any = a.toSorted(); try { b.push(1); 'grew'; } catch (e) { e.name; }")).toBe("TypeError");
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const b: any = a.toReversed(); try { b.push(1); 'grew'; } catch (e) { e.name; }")).toBe("TypeError");
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const b: any = a.with(0, 1); try { b.push(1); 'grew'; } catch (e) { e.name; }")).toBe("TypeError");
});

test("a fixed-extent copy is not a dynamic array, and a spread of it is", () => {
  expectEarlyError("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.toSorted();", "StaticTypeError");
  expectEarlyError("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.toReversed();", "StaticTypeError");
  expectEarlyError("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.with(0, 1);", "StaticTypeError");
  expect(evaluated("const a: [2].<uint8> = [2,1]; const b: [].<uint8> = [...a.toSorted()]; b.push(3); b.join();")).toBe("1,2,3");
  expect(evaluated("const a: [2].<uint8> = [2,1]; const b = a.slice().sort(); b.push(3); b.join();")).toBe("1,2,3");
});

test("a dynamic array's and a window's copies stay dynamic", () => {
  expect(evaluated("const a: [].<uint8> = [3,1,2]; const b = a.toSorted(); b.push(4); b.join();")).toBe("1,2,3,4");
  expect(evaluated("const a: [].<uint8> = [3,1,2]; const b = a.toReversed(); b.push(4); b.join();")).toBe("2,1,3,4");
  expect(evaluated("const a: [].<uint8> = [3,1,2]; const b = a.with(0, 9); b.push(4); b.join();")).toBe("9,1,2,4");
  // A window over a fixed array, with and without a stated length.
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const w: Span.<uint8> = a; const b = w.toSorted(); b.push(4); b.join() + '|' + a.join();")).toBe("1,2,3,4|3,1,2");
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const w: Span.<uint8, 3> = a; const b: [].<uint8> = w.toSorted(); b.push(4); b.join();")).toBe("1,2,3,4");
  expect(evaluated("const a: [3].<uint8> = [3,1,2]; const w: Span.<uint8, 3> = a; const b: [].<uint8> = w.toReversed(); b.push(4); b.join();")).toBe("2,1,3,4");
  expectEarlyError("const a: [3].<uint8> = [3,1,2]; const w: Span.<uint8, 3> = a; const b: [3].<uint8> = w.toSorted();", "StaticTypeError");
});

test("a fixed-extent copy of value elements is the caller's own", () => {
  expect(evaluated("value class P { x: uint8; } const a: [2].<P> = [new P(), new P()]; a[0].x = 5; const b: [2].<P> = a.toReversed(); b[1].x = 9; b[1].x + '|' + a[0].x;")).toBe("9|5");
  expect(evaluated("const a: [3].<uint8> = [1,2,3]; (a.toSorted() === a) + '|' + (a.toReversed() === a) + '|' + (a.with(0, 1) === a);")).toBe("true|false|true");
});

test("copy boundaries accept the created dynamic container", () => {
  expect(evaluated("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.slice(0,1);; \"ok\";")).toBe("ok");
  expect(evaluated("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.filter(x => true);; \"ok\";")).toBe("ok");
  expect(evaluated("const a: [2].<uint8> = [1,2]; const b: [].<uint8> = a.toSpliced(0, 1);; \"ok\";")).toBe("ok");
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

// #sec-intrinsic-array-contracts: "The array `map` builds is new and carries no
// types, as an array literal's does not, so it takes its type where it is
// bound."
test('the array map builds binds at an array type of fixed length', () => {
  // Refused before, in exactly the programs where the checker could establish the built-in, and
  // accepted in every other: an early error that predicted no failure.
  expect(evaluated('const a: [3].<uint8> = [3, 1, 2]; const m: [3].<uint8> = a.map((x) => x); m.join();')).toBe('3,1,2');
  expect(evaluated('const a: [3].<uint8> = [3, 1, 2]; function dbl(x: [3].<uint8>): [3].<uint8> { return x.map((v) => v); } dbl(a).join();')).toBe('3,1,2');
  expect(evaluated('const a: [3].<uint8> = [3, 1, 2]; function first(x: [3].<uint8>): uint8 { return x[0]; } String(first(a.map((v) => v)));')).toBe('3');
  expect(evaluated('const v: [3].<float32> = [1, 2, 3]; const d: [3].<float32> = v.map((x) => x * 2); d.join();')).toBe('2,4,6');
  expect(evaluated('const t: [uint8, uint8] = [1, 2]; const m: [2].<uint8> = t.map((x) => x); m.join();')).toBe('1,2');
  // What is bound is a value of the type it is bound at.
  expect(evaluated('const a: [3].<uint8> = [3, 1, 2]; function f(): string { const m: [3].<uint8> = a.map((x) => x); const c = m; c[0] = 9; return m.join() + "|" + c.join(); } f();')).toBe('3,1,2|9,1,2');
});

test('a map result is refused only where the lengths are known to differ', () => {
  expectEarlyError('const a: [3].<uint8> = [3, 1, 2]; const m: [2].<uint8> = a.map((x) => x);', 'StaticTypeError');
  expectEarlyError('const a: [3].<uint8> = [3, 1, 2]; const m: [3].<string> = a.map((x) => x);', 'StaticTypeError');
  // A receiver with no stated length leaves the length to the check the binding makes when it runs.
  expect(evaluated('const g: [].<uint8> = [3, 1, 2]; const m: [3].<uint8> = g.map((x) => x); m.join();')).toBe('3,1,2');
  expectThrown('const g: [].<uint8> = [3, 1]; const m: [3].<uint8> = g.map((x) => x);', 'is not assignable to');
  // Unbound, the result is a dynamic array as before, and is one where it is later bound.
  expect(evaluated('const a: [3].<uint8> = [3, 1, 2]; const m = a.map((x) => x); m.push(1); String(m.length);')).toBe('4');
  expectEarlyError('const a: [3].<uint8> = [3, 1, 2]; const m = a.map((x) => x); const d: [3].<uint8> = m;', 'StaticTypeError');
  // An operation that chooses its length is unchanged.
  expectEarlyError('const a: [3].<uint8> = [3, 1, 2]; const m: [3].<uint8> = a.filter((x) => true);', 'StaticTypeError');
});
