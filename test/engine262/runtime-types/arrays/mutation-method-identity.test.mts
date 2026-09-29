import { expect, test } from 'vitest';
import { evaluated, evaluatedSequence, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// #sec-intrinsic-array-contracts
for (const name of ['push', 'unshift']) {
  test(`${name} checks every inserted value at a proved intrinsic`, () => {
    expectStaticTypeError(`if (false) { const a:[].<uint8>=[]; a.${name}(1, "bad"); }`);
    expect(ok(`const a:[].<uint8>=[]; a.${name}(1, 2);`)).toBe(true);
    expect(ok(`const a:[].<uint8>=[]; a.${name}();`)).toBe(true);
  });

  test(`${name} leaves unresolved receivers to the runtime store boundary`, () => {
    expect(ok(`if (false) { let a:[].<uint8>=[]; a.${name}("bad"); }`)).toBe(true);
    expectThrownKind(`let a:[].<uint8>=[]; a.${name}("bad");`, 'TypeError');
  });

  test(`${name} does not impose an intrinsic signature on a replacement`, () => {
    expect(evaluated(`let a:[].<uint8>=[]; a.${name}=function(v) { return v; }; a.${name}("own");`)).toBe('own');
    expect(evaluated(`Array.prototype.${name}=function(v) { return v; }; const a:[].<uint8>=[]; a.${name}("prototype");`)).toBe('prototype');
    expect(evaluated(`function change() { Array.prototype.${name}=function(v) { return v; }; } change();`
      + ` const a:[].<uint8>=[]; a.${name}("effect");`)).toBe('effect');
  });

  test(`${name} observes replacement by a previous script`, () => {
    expect(evaluatedSequence([
      `Array.prototype.${name}=function(v) { return v; };`,
      `const a:[].<uint8>=[]; a.${name}("previous");`,
    ])).toBe('previous');
  });
}
