import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators-remaining.md phase four: `signatures` on
 * `ClassMethodReflection`.
 *
 * decorators.md: "signatures: [].<FunctionSignatureReflection> - Length 1 when
 * not overloaded", where a `FunctionSignatureReflection` is
 * `{ parameters, return }`.
 */

const GRAB = 'let ctx; function g(c) { ctx = c; } ';

test('a method reports ONE signature', () => {
  // "Length 1 when not overloaded" - and a CLASS METHOD is never overloaded in
  // this engine: a second declaration of one name REPLACES the first. A
  // FUNCTION declaration does form an overload group, which is what makes this
  // a property of the position rather than of the language.
  expect(evaluated(`${GRAB} class A { @g m(): uint8 { return uint8(1); } } String(ctx.signatures.length);`)).toBe('1');
  expect(evaluated('class A { m(x: uint8) { return 1; } m(x: string) { return 2; } } '
    + 'const a = new A(); String(a.m(uint8(1)));')).toBe('2');
  expect(evaluated('function f(x: uint8) { return 1; } function f(x: string) { return 2; } '
    + 'String(f(uint8(1)));')).toBe('1');
});

test('a signature carries its PARAMETERS, each fully described', () => {
  const M = `${GRAB} class A { @g m(a: uint8, x: uint32 = 7): uint8 { return uint8(1); } } `;
  expect(evaluated(`${M} String(ctx.signatures[0].parameters.length);`)).toBe('2');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[1].name);`)).toBe('x');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[1].index);`)).toBe('1');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[1].type === (type uint32));`)).toBe('true');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[1].initial);`)).toBe('7');
  // The first parameter is described independently - so this is read per
  // parameter rather than one description repeated.
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[0].type === (type uint8));`)).toBe('true');
  expect(evaluated(`${M} String(ctx.signatures[0].parameters[0].initial);`)).toBe('undefined');
  // A method with no parameters has an empty list, not an absent one.
  expect(evaluated(`${GRAB} class A { @g m(): uint8 { return uint8(1); } } String(ctx.signatures[0].parameters.length);`)).toBe('0');
});

test('a signature carries its RETURN', () => {
  expect(evaluated(`${GRAB} class A { @g m(): uint8 { return uint8(1); } } String(ctx.signatures[0].return.type === (type uint8));`)).toBe('true');
  expect(evaluated(`${GRAB} class A { @g m(): string { return ""; } } String(ctx.signatures[0].return.type === (type string));`)).toBe('true');
  // An unannotated return reports no type rather than inventing one.
  expect(evaluated(`${GRAB} class A { @g m() {} } String(ctx.signatures[0].return.type);`)).toBe('undefined');
});

test('the signature agrees with the PARAMETER CONTEXT about one declaration', () => {
  // Both are read from the same node, which is what stops two reflections of
  // one parameter from disagreeing - the failure this plan has met repeatedly.
  const P = 'let p; function h(c) { p = c; } ';
  expect(evaluated(`${GRAB}${P} class A { @g m(@h x: uint32 = 7) {} } `
    + 'String(p.name === ctx.signatures[0].parameters[0].name);')).toBe('true');
  expect(evaluated(`${GRAB}${P} class A { @g m(@h x: uint32 = 7) {} } `
    + 'String(p.type === ctx.signatures[0].parameters[0].type);')).toBe('true');
  expect(evaluated(`${GRAB}${P} class A { @g m(@h x: uint32 = 7) {} } `
    + 'String(p.initial === ctx.signatures[0].parameters[0].initial);')).toBe('true');
});
