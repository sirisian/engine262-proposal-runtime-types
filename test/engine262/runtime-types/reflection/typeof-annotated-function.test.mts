import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * `ResolveTypeName` resolved through `ResolveBinding` with no environment, which
 * reads the RUNNING execution context's LexicalEnvironment. A BUILT-IN's context
 * has none, so every path that resolved a type name from inside a built-in
 * function hit an Assert and brought the HOST down - not a thrown error, a dead
 * process.
 *
 * `Reflect.typeOf` of an annotated function is the ordinary way to meet it, and
 * the annotations that survived were the ones `builtinTypeRecord` names before
 * the scope walk is reached. That is what made it look like a problem with
 * particular type names rather than with the caller.
 */

test('Reflect.typeOf resolves an annotation naming a user ALIAS', () => {
  expect(evaluated('type MyType = uint8; function m(c: MyType): uint8 { return 1; } String(Reflect.typeOf(m) !== undefined);')).toBe('true');
});

test('… a CLASS', () => {
  expect(evaluated('class C {} function m(c: C): uint8 { return 1; } String(Reflect.typeOf(m) !== undefined);')).toBe('true');
});

test('… a QUALIFIED reflection name', () => {
  expect(evaluated('function m(c: Reflect.Block): uint8 { return 1; } String(Reflect.typeOf(m) !== undefined);')).toBe('true');
});

test('… and a LIBRARY type inside a composite annotation', () => {
  expect(evaluated('function m(s: uint8): [].<Token> { return []; } String(Reflect.typeOf(m) !== undefined);')).toBe('true');
});

test('a built-in primitive still resolves, which always worked', () => {
  // The control: this answered before the fix, and only because the primitives
  // are named ahead of the scope walk.
  expect(evaluated('function m(c: string): uint8 { return 1; } String(Reflect.typeOf(m) !== undefined);')).toBe('true');
});

test('the signature is READ, not merely survived', () => {
  // Not crashing is not the same as resolving. The parameter list is reachable
  // and its second entry's type is identity-equal to the type it names - which
  // is the predicate capture by signature is built on.
  const M = 'function m(s: TokenStream, c: Reflect.Block): [].<Token> { return []; } ';
  expect(evaluated(`${M}String(Reflect.getReflection(Reflect.typeOf(m)).kind);`)).toBe('function');
  expect(evaluated(`${M}String(Reflect.getReflection(Reflect.typeOf(m)).signatures[0].parameters.length);`)).toBe('2');
  expect(evaluated(`${M}String(Reflect.getReflection(Reflect.typeOf(m)).signatures[0].parameters[1].type === (type Reflect.Block));`)).toBe('true');
});
