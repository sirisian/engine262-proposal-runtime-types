import { test, expect } from 'vitest';
import {
  evaluated, expectEarlyError, expectThrown,
} from '../harness.mts';
import {
  Agent, ManagedRealm, setSurroundingAgent, Parser,
} from '#self';
import type { ParseNode } from '#self';

/**
 * proposal-runtime-types #sec-specialization-lists, #sec-capture-scope, and
 * #sec-type-parameters-static-semantics-early-errors: a declaration's list is
 * parsed into parameters and arguments, captures are collected, and the
 * errors that syntax alone decides are reported before anything runs. Plan:
 * runtime-types const specialization, phase 3 (C02, C05, C21).
 *
 * Selecting a specialization is phases 4 and 5, so every valid specialization
 * list still reports that it is not supported; what these tests pin is that a
 * MORE SPECIFIC error comes first where there is one.
 */

function typeParametersOf(source: string): ParseNode.TypeParameters {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const pop = realm.pushTopContext();
  try {
    const script = (new Parser({ source }) as unknown as { parseScript(): ParseNode.Script }).parseScript();
    return (script.ScriptBody!.StatementList[0] as unknown as { TypeParameters: ParseNode.TypeParameters }).TypeParameters;
  } finally {
    pop?.();
  }
}

test('a specialization list keeps its arguments apart from its parameters', () => {
  const list = typeParametersOf('class X<Map.<K: string, V: const E>, [const N].<E>, _> {}');
  expect(list.ListKind).toBe('specialization');
  expect(list.TypeParameterList).toEqual([]);
  expect(list.EntryKinds).toEqual(['argument', 'argument', 'argument']);
  expect(list.Captures!.map((c) => c.BindingIdentifier.name)).toEqual(['E', 'N']);
  // The nested capture carries the nested constructor's label, as a type does.
  expect((list.Captures![0] as unknown as { ArgumentName?: string }).ArgumentName).toBe('V');
  const extent = (list.SpecializationEntryList![1].Pattern as ParseNode.ArrayType).ArrayExtent as unknown as ParseNode;
  expect(extent.type).toBe('CaptureBinding');
});

test('a mixed list keeps its binders in TypeParameterList, in order', () => {
  const list = typeParametersOf('function write<float32, maximum: float32, bits: uint32>(v: float32) {}');
  expect(list.ListKind).toBe('mixed');
  expect(list.TypeParameterList.map((p) => p.BindingIdentifier.name)).toEqual(['maximum', 'bits']);
  expect(list.EntryKinds).toEqual(['argument', 'parameter', 'parameter']);
  expect(typeParametersOf('function f<T: type, N: uint32>() {}').ListKind).toBe('parameters');
  expect(typeParametersOf('class X<> {}').ListKind).toBe('specialization');
});

test('captures: variadic, holes, domain, and bound', () => {
  const list = typeParametersOf('class X<Tuple.<...const Ts>, Apply.<const W<_>, const T extends Small>, [const H, ...const R]> {}');
  const byName = Object.fromEntries(list.Captures!.map((c) => [c.BindingIdentifier.name, c]));
  expect(Object.keys(byName)).toEqual(['Ts', 'W', 'T', 'H', 'R']);
  expect(byName.Ts.IsVariadic).toBe(true);
  expect(byName.W.Arity).toBe(1);
  expect(byName.T.TypeParameterConstraint!.sourceText).toBe('Small');
  expect(byName.R.IsVariadic).toBe(true);
});

test('C21: a capture declared twice is refused, even where the annotations agree', () => {
  expectEarlyError('class Pair<const T, const T> {}', 'SyntaxError');
  expectEarlyError('class S<Map.<const T: type, const T: type>> {}', 'SyntaxError');
  expectThrown('class S<Map.<const T, Set.<const T>>> {}', '`T` is already captured in this list');
});

test('a capture belongs to a specialization entry', () => {
  expectEarlyError('let x: Map.<string, const E>;', 'SyntaxError');
  expectEarlyError('function f<T: type>() {} f.<const T>();', 'SyntaxError');
  // A parameter's domain is not an entry, nor is a capture's own domain.
  expectEarlyError('function f<T: Map.<string, const E>>() {}', 'SyntaxError');
  expectEarlyError('class S<const T: Map.<string, const E>> {}', 'SyntaxError');
  expectThrown('let x: Map.<string, const E>;', 'belongs in a declaration\'s specialization list; supply an argument here');
});

test('a builder call exposes no component', () => {
  expectEarlyError('class S<Make(const T)> {}', 'SyntaxError');
  expectEarlyError('class S<Make.<const T>(1)> {}', 'SyntaxError');
  expectThrown('class S<Make(const T)> {}', 'stands in the arguments of a builder call');
  // A capture REFERENCE in a builder's arguments is a forward computation, and
  // reaches the not-supported error rather than this one.
  expectThrown('class S<const T, Make(T)> {}', 'specialization is not supported yet');
});

test('a mixed list is a selector-prefixed overload, which only a callable declares', () => {
  expectEarlyError('class Box<uint32, N: 8> {}', 'SyntaxError');
  expectEarlyError('interface V<uint32, N: uint32> {}', 'SyntaxError');
  expectEarlyError('type A<uint32, N: uint32> = uint32;', 'SyntaxError');
  expectThrown('class Box<uint32, N: 8> {}', 'which only a function, method, or operator may');
  // A capture at the top of a mixed list observes nothing a caller could not name.
  expectThrown('function f<const T, N: uint32>() {}', 'declare `T: type`, or a value domain, as a parameter');
  // A callable's mixed list declares a standalone case (plan section 3.8, A3);
  // selecting it is refused until phase 4, step 2.
  expect(evaluated('function write<float32, maximum: float32>(v: float32) {} "ok";')).toBe('ok');
  expect(evaluated('class W { write<float32, maximum: float32>(v: float32) {} } "ok";')).toBe('ok');
});

test('a list that describes or introduces a generic declares parameters only', () => {
  expectEarlyError('const C = class<uint32> {};', 'SyntaxError');
  expectEarlyError('const f = function<uint32>() {};', 'SyntaxError');
  expectEarlyError('type F = <uint32>(x: uint32) => void;', 'SyntaxError');
  expectEarlyError('interface I { m<uint32>(x: uint32): void; }', 'SyntaxError');
  expectThrown('type F = <uint32>(x: uint32) => void;', 'declares parameters only');
});

test('an argument carries no variance, bound, or default', () => {
  expectThrown('class S<out uint8> {}', 'an argument of a specialization list has none');
  expectThrown('class S<Map.<string, uint8> extends B> {}', 'an argument has no `extends` bound');
});

test('a valid specialization still reports that selection is not supported', () => {
  // Not as a second declaration of the family's name: a specialization
  // introduces no binding of its own.
  expectThrown('class Box<T: type> {} class Box<uint32> {}', 'specialization is not supported yet');
  expectThrown('class Store<T: type> {} class Store<Map.<K: string, V: const E>> {}', 'specialization is not supported yet');
  expectThrown('class Box<> {}', '`<>` specializes a declared family at its defaults');
  expectThrown('class M { operator+.<uint32>(rhs: uint32) { return this; } }', 'specialization is not supported yet');
  // A second PRIMARY of one name is still a duplicate declaration.
  expectThrown('class Box<T: type> {} class Box<U: type> {}', 'already declared');
});

test('ordinary applications keep named arguments, extents, and tuples', () => {
  expect(evaluated('let m: Map.<K: string, V: uint32> = new Map(); typeof m;')).toBe('object');
  expect(evaluated('let a: [2].<uint8> = [1, 2]; String(a.length);')).toBe('2');
  expect(evaluated('let t: [uint8, string] = [(1 := uint8), "a"]; t[1];')).toBe('a');
  expect(evaluated('class B<N: uint32> {} String(new B.<4>() instanceof B.<4>);')).toBe('true');
});
