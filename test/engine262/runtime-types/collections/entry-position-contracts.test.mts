import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "new Map.<string,uint8>([1]);",
  "new Map.<string,uint8>([[\"x\"]]);",
  "new Map.<string,uint8>([{0:\"x\",1:\"bad\"}]);",
  "new Map.<string,uint8>([[\"x\",undefined]]);",
  "new Map.<string,uint8>([1,[\"x\",1]]);",
  "new Map.<string,uint8>([{0:\"x\"}]);"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "new Map.<string,uint8>([{0:\"x\",1:1}]);",
  "new Map.<string,uint8>([[\"x\",\"bad\"],[\"x\",1]]);",
  "new Map.<string,uint8|undefined>([[\"x\"]]);",
  "new Map.<string,uint8|undefined>([{0:\"x\"}]);",
  "new Map.<string,uint8>([{0:\"x\",1:\"bad\"},{0:\"x\",1:1}]);",
  "new Map.<string,uint8>([{0:\"x\",get 1(){return 1;}}]);",
  "{const undefined=9;new Map.<string,uint8|undefined>([[\"x\"]]);}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test("map entry proto", () => {
  expect(evaluatedSequence([
  "Array.prototype[1]=1;",
  "new Map.<string,uint8>([[\"x\"]]);\"accepted\";"
])).toBe('accepted');
});

test("preserves the prior-script dependency: new Map.<string,uint8>([{0:\"x\"}]);", () => {
  expect(evaluatedSequence([
  "Object.prototype[1]=1;",
  "new Map.<string,uint8>([{0:\"x\"}]);\"accepted\";"
])).toBe('accepted');
});

test('an unknown earlier entry read retains dynamic traversal', () => {
  expect(evaluatedSequence([
    'globalThis.entry={get 0(){throw new Error("read");},1:1};',
    'try{new Map.<string,uint8>([entry,1]);}catch(e){} "accepted";',
  ])).toBe('accepted');
});
