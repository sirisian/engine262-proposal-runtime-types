import { expect, test } from 'vitest';
import { evaluated, evaluatedSequence, expectStaticTypeError, expectThrownKind } from '../harness.mts';

// #sec-intrinsic-array-contracts
for (const method of ['map', 'flatMap', 'forEach']) {
  test(`${method} contextualizes callbacks only at proved intrinsics`, () => {
    for (const binding of ['const', 'let']) {
      expectStaticTypeError(`${binding} a: [].<uint8> = [1]; a.${method}(x => { let s: string = x; return s; });`);
    }
    expect(evaluated(`function f(a: [].<uint8>) { a.${method}(x => { let s: string = x; return s; }); } "ok";`)).toBe('ok');
    expect(evaluated(`if (false) { let a: [].<uint8> = [1]; a = []; a.${method}(x => { let s: string = x; return s; }); } "ok";`)).toBe('ok');
    expectThrownKind(`function f(a: [].<number>) { a.${method}(x => { let n: uint8 = x; return n; }); } f([300]);`, 'RangeError');
  });

  test(`${method} accepts callbacks for an own replacement`, () => {
    expect(evaluated(`const a: [].<uint8> = [1]; a.${method} = function(cb) { return cb("own"); };`
      + ` a.${method}(x => { let s: string = x; return s; });`)).toBe('own');
    expect(evaluated(`const a: [].<uint8> = [1]; Object.defineProperty(a, "${method}",`
      + ' { get() { return function(cb) { return cb("getter"); }; } });'
      + ` a.${method}(x => { let s: string = x; return s; });`)).toBe('getter');
  });

  test(`${method} observes prototype changes in this and previous scripts`, () => {
    expect(evaluated(`Array.prototype.${method} = function(cb) { return cb("prototype"); };`
      + ` const a: [].<uint8> = [1]; a.${method}(x => { let s: string = x; return s; });`)).toBe('prototype');
    expect(evaluatedSequence([
      `Array.prototype.${method} = function(cb) { return cb("previous"); };`,
      `const a: [].<uint8> = [1]; a.${method}(x => { let s: string = x; return s; });`,
    ])).toBe('previous');
  });

  test(`${method} defers when calls or callbacks replace dependencies`, () => {
    expect(evaluated(`function change() { Array.prototype.${method} = function(cb) { return cb("effect"); }; }`
      + ` change(); const a: [].<uint8> = [1]; a.${method}(x => { let s: string = x; return s; });`)).toBe('effect');
    expect(evaluated(`const a: [].<uint8> = [1]; a.${method}(() => {`
      + ` Array.prototype.${method} = function(cb) { return cb("callback"); }; return 1; });`
      + ` a.${method}(x => { let s: string = x; return s; });`)).toBe('callback');
  });
}

for (const method of ['map', 'flatMap']) {
  test(`${method} infers results only from the selected intrinsic`, () => {
    expectStaticTypeError(`const a: [].<uint8> = [1]; let b: [].<string> = a.${method}(x => x);`);
    expect(evaluated(`const a: [].<uint8> = [1]; a.${method} = function(cb) { return "own"; };`
      + ` let result: string = a.${method}(x => 1); result;`)).toBe('own');
    expect(evaluatedSequence([
      `Array.prototype.${method} = function(cb) { return "previous"; };`,
      `const a: [].<uint8> = [1]; let result: string = a.${method}(x => 1); result;`,
    ])).toBe('previous');
  });
}

test('untyped array callbacks retain ordinary JavaScript argument values', () => {
  expect(evaluated('[1].map((x: number) => x); "ok";')).toBe('ok');
  expect(evaluated('[1].forEach((x: number) => x); "ok";')).toBe('ok');
});
