import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "const a:[2].<uint8>=[1,2];a.push(1);",
  "const a:[2].<uint8>=[1,2];a.pop();",
  "const a:[2].<uint8>=[1,2];a.splice(0,1);",
  "const a:[2].<uint8>=[1,2];a.unshift(1);",
  "const a:[2].<uint8>=[1,2];a.shift();",
  "const a:[2].<uint8>=[1,2];a.splice(-1);"
])('rejects an invalid established contract: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "const a:[2].<uint8>=[1,2];a.splice(0,1,3);",
  "const a:[2].<uint8>=[1,2];a.push();",
  "const a:[0].<uint8>=[];a.pop();",
  "const a:[2].<uint8>=[1,2];Object.defineProperty(a,\"push\",{value:function(){return 2;}});a.push(1);",
  "function unused(a:[2].<uint8>){a.push(1);}",
  "const a:[0].<uint8>=[];a.shift();",
  "const a:[2].<uint8>=[1,2];a.unshift();",
  "const a:[2].<uint8>=[1,2];a.splice();",
  "const a:[2].<uint8>=[1,2];a.splice(5,1);",
  "const a:[2].<uint8>=[1,2];a.splice(-1,1,3);",
  "const a:[].<uint8>=[1,2];a.push(1);a.pop();a.shift();a.unshift(2);"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test('an earlier script may replace the mutator', () => {
  expect(evaluatedSequence([
    'Array.prototype.push = function(){return 2;}; "ready";',
    'const a:[2].<uint8>=[1,2];a.push(1); "accepted";',
  ])).toBe('accepted');
});
