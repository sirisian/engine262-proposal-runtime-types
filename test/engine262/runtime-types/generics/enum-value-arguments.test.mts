import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-generic-parameters-as-values, #sec-bindtypearguments
test('an enum member supplies positional and named value arguments', () => {
  const source = 'enum E: uint8 { A, B }; function f<C: E>(): string { return String(C); } ';
  expect(evaluated(source + 'f.<E.A>();')).toBe('0');
  expect(evaluated(source + 'f.<C: E.B>();')).toBe('1');
  expectStaticTypeError(source + 'f();');
  expectStaticTypeError(source + 'enum Other: uint8 { A, B }; f.<Other.B>();');
});

test('an enum value default supplies an omitted argument', () => {
  expect(evaluated('enum E: uint8 { A, B }; function f<C: E = E.B>(): string { return String(C); } f();')).toBe('1');
});

test('a lexical value can shadow the name of an enum', () => {
  expect(evaluated('enum E: uint8 { A, B }; function f<C: string>(): string { return String(C); }'
    + ' { const E = { B: "local" }; f.<E.B>(); }')).toBe('local');
});
