import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

test.each(['E()', 'E(_, _)'])('extractor %s checks its declared tuple length', (pattern) => {
  expectStaticTypeError(`class E { static [Symbol.customMatcher](v: any): [uint8] { return [1]; } } function f() { return 1 is ${pattern}; }`);
});

test('Boolean matchers cannot be used for tuple extraction', () => {
  expectStaticTypeError('class E { static [Symbol.customMatcher](v: any): boolean { return true; } } function f() { return 1 is E(); }');
});

test('extractor subjects are arguments to the matcher', () => {
  expectStaticTypeError('class E { static [Symbol.customMatcher](v: uint8): [uint8] { return [v]; } } function f() { return "bad" is E(_); }');
});

test('the matcher return types its extracted bindings', () => {
  expectStaticTypeError('class E { static [Symbol.customMatcher](v: any): [uint8] { return [1]; } } function f(v: any) { return match(v) { when E(let x): { let a: [uint8] = x; a; } default: [0]; }; }');
  expect(evaluated('class E { static [Symbol.customMatcher](v: any): [uint8] { return [1]; } } String(match(1) { when E(let x): x; default: 0; });')).toBe('1');
});

test('class membership does not call its custom matcher', () => {
  expect(evaluated('let calls = 0; class E { static [Symbol.customMatcher](v: any): [uint8] { calls++; return [1]; } } let e: E = new E(); (e is E); String(calls);')).toBe('0');
});

test('generic matchers infer extracted positions from their subjects', () => {
  expectStaticTypeError('class E { static [Symbol.customMatcher]<T: type>(v: T): [T] { return [v]; } } function f(v: uint8) { return match(v) { when E(let x): { let a: [uint8] = x; a; } default: [0]; }; }');
  expect(evaluated('class E { static [Symbol.customMatcher]<T: type>(v: T): [T] { return [v]; } } String(match(uint8(1)) { when E(let x): x; default: 0; });')).toBe('1');
});

test('nullable matcher returns preserve non-match and successful tuple positions', () => {
  expect(evaluated('class E { static [Symbol.customMatcher](v: any): [uint8] | null { return null; } } match(1) { when E(let x): String(x); default: "miss"; };')).toBe('miss');
  expectStaticTypeError('class E { static [Symbol.customMatcher](v: any): [uint8] | null { return null; } } function f() { return 1 is E(_, _); }');
});

test('overload selection uses the subject type', () => {
  expect(evaluated('class E { static [Symbol.customMatcher](v: uint8): [uint8] { return [v]; } static [Symbol.customMatcher](v: string): [string, string] { return [v, v]; } } match("a") { when E(let x, let y): x + y; default: "miss"; };')).toBe('aa');
  expectStaticTypeError('class E { static [Symbol.customMatcher](v: uint8): [uint8] { return [v]; } static [Symbol.customMatcher](v: string): [string, string] { return [v, v]; } } function f() { return "a" is E(_); }');
});

test('unknown matcher heads and subjects retain runtime resolution', () => {
  expect(evaluated('class E { static [Symbol.customMatcher](v: uint8): [uint8] { return [v]; } } function f(head: any, value: any) { return match(value) { when head(let x): String(x); default: "miss"; }; } f(E, uint8(1));')).toBe('1');
});

test('an interface matcher uses the same computed signature as a class matcher', () => {
  expectStaticTypeError('interface Matcher { [Symbol.customMatcher](v: any): boolean; } function f(head: Matcher) { return 1 is head(_); }');
});
