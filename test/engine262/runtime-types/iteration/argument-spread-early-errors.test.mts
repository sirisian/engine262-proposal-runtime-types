import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok, runFlagOff } from '../harness.mts';

for (const type of ['uint8', 'symbol', 'boolean']) {
  for (const call of ['Array(...value)', 'new Array(...value)', 'new C(...value)']) {
    test(`argument spread: ${type} is rejected before ${call} executes`, () => {
      expectStaticTypeError(`class C { constructor(...xs) {} } function unused(value: ${type}) { ${call}; }`);
    });
  }
  test(`argument spread: ${type} is rejected in an uninstantiated superclass call`, () => {
    expectStaticTypeError(`class B { constructor(...xs) {} } class C extends B { constructor(value: ${type}) { super(...value); } }`);
  });
}

test('constructor spreads preserve strings, custom iterators and their effects', () => {
  expect(evaluated('new Array(..."ab").join("");')).toBe('ab');
  expect(evaluated('let effects = 0; let xs: [string] = ["s"]; xs[Symbol.iterator] = function*(): uint8 { effects++; yield 2; yield 3; }; class C { constructor(...xs) { this.result = String(xs[0]) + String(xs[1]); } } const c = new C(...xs); c.result + ":" + effects;')).toBe('23:1');
  expect(evaluated('class B { constructor(...xs) { this.result = String(xs[0]); } } class C extends B { constructor(xs: [].<uint8>) { super(...xs); } } new C([2]).result;')).toBe('2');
});

test('constructor object spreads may supply named arguments', () => {
  expect(evaluated('class C { constructor(x: uint8) { this.result = String(x); } } new C(...{x: (2 := uint8)}).result;')).toBe('2');
});

test('unknown spreads and feature-off code retain runtime checking', () => {
  expect(ok('function unused(value: any) { new Array(...value); }')).toBe(true);
  expectThrownKind('function run(value: any) { new Array(...value); } run(1);', 'TypeError');
  expect(runFlagOff('function unused(value) { new Array(...value); }')).toMatchObject({ Type: 'normal' });
});
