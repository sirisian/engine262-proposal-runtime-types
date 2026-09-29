import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "const a:[].<uint8>=Array.from(Composite.<[string]>([\"s\"]),(x:string):string=>x);",
  "const a:[].<uint8>=Array.from(Composite.<[uint8]>([1]),(x:uint8):string=>\"s\");",
  "const a:[].<uint8>=Array.from(Composite.<[string]>([\"s\"]));",
  "const a:[1].<string>=Array.from(Composite.<[string]>([\"s\"]));"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "const a:[].<string>=Array.from(Composite.<[string]>([\"s\"]),(x:string):string=>x);",
  "const a:[].<string>=Array.from(Composite.<[string]>([\"s\"]));",
  "const a:[].<uint8>=Array.from(Composite.<[string]>([\"s\"]),(x:string):any=>1);"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test("from replaced prior", () => {
  expect(evaluatedSequence([
  "Array.from=function(){return [1];};",
  "const a:[].<uint8>=Array.from(Composite.<[string]>([\"s\"]),(x:string):string=>x);\"accepted\";"
])).toBe('accepted');
});
