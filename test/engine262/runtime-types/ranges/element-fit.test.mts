import { expect, test } from 'vitest';
import { evaluated, expectThrown, ok } from '../harness.mts';

// #sec-range-domain-membership separates stored endpoint admission from
// #sec-range-literals' produced-element fit. These formerly shared a context.
const iterating = (range: string, type = 'uint8') => `function f() { for (const x: ${type} of ${range}) {} }`;
const at = (range: string, type = 'uint8', family = 'ClosedOpenRange') => [
  `let r: ${family}.<${type}> = ${range};`,
  `function f(r: ${family}.<${type}>) {} f(${range});`,
  `function g(): ${family}.<${type}> { return ${range}; }`,
];

test('iteration admits excluded sentinels; stored endpoints must fit', () => {
  expect(ok(iterating('0..<256'))).toBe(true);
  expect(ok(iterating('0<..<256'))).toBe(true);
  for (const src of at('0..<256')) expectThrown(src, '256');
  for (const src of at('0..=255', 'uint8', 'ClosedRange')) expect(ok(src)).toBe(true);
  expect(ok('let r: Range.<uint8, Range.Bound.Open, Range.Bound.Closed> = 0<..=255;')).toBe(true);
});

test('empty iteration fits any element domain, but its endpoints still exist', () => {
  for (const range of ['10..<0', '5..<5', '300..<0']) expect(ok(`function f() { const a: [].<uint8> = [...${range}]; }`)).toBe(true);
  for (const src of at('10..<0')) expect(ok(src)).toBe(true);
  for (const src of at('300..<0')) expectThrown(src, '300');
});

test('iteration refuses an out-of-domain produced value, naming that value', () => {
  expectThrown(iterating('0..=256'), '256');
  expectThrown(iterating('0..<257'), '256');
  expectThrown(iterating('0..<300'), '299');
});

test('unbounded intervals can be stored but cannot iterate at a bounded type', () => {
  expect(ok('let r: RangeFrom.<uint8> = 0..;')).toBe(true);
  expectThrown(iterating('0..'), 'no upper bound');
  expectThrown(iterating('0..<Infinity'), 'no upper bound');
  expectThrown('let r: ClosedOpenRange.<uint8> = 0..<Infinity;');
});

test('number and bigint endpoint intervals retain their domains', () => {
  expect(ok('let r: RangeFrom.<number> = 0..;')).toBe(true);
  expect(ok('let r: ClosedOpenRange.<bigint> = 0n..<(2n ** 80n);')).toBe(true);
  expect(evaluated('let r: ClosedOpenRange.<float32> = 0.5..<3; String(r.end is float32);')).toBe('true');
});

test('a runtime-only endpoint is checked at construction', () => {
  expectThrown('let n = 300; let r: ClosedOpenRange.<uint8> = 0..<n;', '300');
  expect(ok('let n = 5; let r: ClosedOpenRange.<uint8> = 0..<n;')).toBe(true);
});

test('a typed endpoint guides direct-literal iteration without typing its bounds', () => {
  expectThrown('function f(s: uint8) { for (const x of s..<300) {} }', '299');
  expectThrown('function f(e: uint8) { for (const x of -1..=e) {} }', '-1');
  expect(ok('function f(s: uint8) { for (const x of s..<256) {} }')).toBe(true);
  expect(ok('function f(e: uint8) { for (const x of 300..=e) {} }')).toBe(true);
  // An interval is useful without being iterated; forming one has no produced-value check.
  expect(ok('function f(s: uint8) { const r = s..<300; }')).toBe(true);
});

test('an iterating float range must produce only exact values', () => {
  for (const range of ['0..<2049', '-2048..=2048', '2050..<2051']) expect(ok(iterating(range, 'float16'))).toBe(true);
  expectThrown(iterating('2049..<2050', 'float16'), '2049');
  expectThrown(iterating('0..<4000', 'float16'), '2049');
  expectThrown(iterating('0..<100000', 'float16'), '2049');
  expect(ok(iterating('0..<16777217', 'float32'))).toBe(true);
  expectThrown(iterating('0..<16777218', 'float32'), '16777217');
});

test('stored floating endpoints follow ordinary literal rounding and overflow', () => {
  expect(evaluated('let r: ClosedOpenRange.<float32> = 0.1..<0.9; String(r.start is float32);')).toBe('true');
  expect(ok('let r: ClosedOpenRange.<float16> = 2049..<2050;')).toBe(true);
  expectThrown('let r: ClosedOpenRange.<float32> = 0.5..<1e39;');
  expectThrown('let r: ClosedOpenRange.<float16> = 0.5..<70000.5;');
});
