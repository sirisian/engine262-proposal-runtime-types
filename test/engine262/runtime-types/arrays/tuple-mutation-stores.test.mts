import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "const a:[uint8,string]=[1,\"s\"];a.reverse();",
  "const a:[uint8,string]=[1,\"s\"];a.copyWithin(0,1);",
  "const a:[uint8,string]=[1,\"s\"];a.fill(\"x\");",
  "const a:[uint8,string]=[1,\"s\"];a.splice(0,1,\"x\");",
  "const a:[uint8,string,uint8]=[1,\"s\",2];a.copyWithin(2,1);",
  "const a:[uint8,string,uint8]=[1,\"s\",2];a.fill(\"s\",-1);"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "const a:[uint8,uint8]=[1,2];a.reverse();",
  "const a:[uint8,string]=[1,\"s\"];a.fill(\"x\",1);",
  "const a:[uint8,string]=[1,\"s\"];a.copyWithin(0,0,1);",
  "const a:[uint8,string]=[1,\"s\"];a.splice(1,1,\"x\");",
  "function unused(a:any){a.reverse();}",
  "const a:[uint8,string]=[1,\"s\"];a.fill(\"x\",1,1);",
  "const a:[uint8,string]=[1,\"s\"];a.fill(1,1);",
  "const a:[uint8,uint8,uint8]=[1,2,3];a.copyWithin(1,0,2);"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test("tuple reverse replaced", () => {
  expect(evaluatedSequence([
  "Array.prototype.reverse=function(){return this;};",
  "const a:[uint8,string]=[1,\"s\"];a.reverse();\"accepted\";"
])).toBe('accepted');
});

test("preserves the prior-script dependency: const a:[uint8,string]=[1,\"s\"];a.copyWithin(0,1);", () => {
  expect(evaluatedSequence([
  "Array.prototype.copyWithin=function(){return this;};",
  "const a:[uint8,string]=[1,\"s\"];a.copyWithin(0,1);\"accepted\";"
])).toBe('accepted');
});

test('a shrinking splice checks shifts before tail deletion', () => {
  expectStaticTypeError('const a:[uint8,string,uint8]=[1,"s",2];a.splice(0,1);');
});
