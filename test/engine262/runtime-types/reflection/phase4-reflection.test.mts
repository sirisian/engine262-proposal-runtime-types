import { test } from 'vitest';
import { expectBuilderTrue } from '../corpus/type-challenges/harness.mts';

/**
 * Phase 4 enabling primitive — Reflect.getReflection.
 * Source: proposal spec #sec-getreflection (the Reflect.Type context), the
 * node-shape table.
 *
 * getReflection is the read side of reflection: it builds the node object
 * describing a Type Record, the inverse of makeType's node reader. The spec's
 * load-bearing property is the round trip:
 *   For every type T, Reflect.makeType(Reflect.getReflection(T)) is T.
 * These tests assert that round trip across the kinds, and that reading node
 * fields works, since the kit is written over exactly these reads.
 */

test('round trip · primitive', () => {
  expectBuilderTrue('String(Reflect.makeType(Reflect.getReflection(uint8)) === uint8);');
});

test('round trip · literal', () => {
  expectBuilderTrue(`
    type L = 'x';
    String(Reflect.makeType(Reflect.getReflection(L)) === L);
  `);
});

test('round trip · union', () => {
  expectBuilderTrue(`
    type U = 'a' | 'b' | 'c';
    String(Reflect.makeType(Reflect.getReflection(U)) === U);
  `);
});

test('round trip · object', () => {
  expectBuilderTrue(`
    type O = { x: uint8, y: string };
    String(Reflect.makeType(Reflect.getReflection(O)) === O);
  `);
});

test('round trip · tuple', () => {
  expectBuilderTrue(`
    type T = [uint8, string, boolean];
    String(Reflect.makeType(Reflect.getReflection(T)) === T);
  `);
});

test('round trip · array', () => {
  expectBuilderTrue(`
    type A = [].<uint8>;
    String(Reflect.makeType(Reflect.getReflection(A)) === A);
  `);
});

test('round trip · intersection', () => {
  expectBuilderTrue(`
    type I = { a: uint8 } & { b: string };
    String(Reflect.makeType(Reflect.getReflection(I)) === I);
  `);
});

test('round trip · deeply nested', () => {
  expectBuilderTrue(`
    type N = { list: [].<{ v: uint8 }>, tag: 'x' | 'y' };
    String(Reflect.makeType(Reflect.getReflection(N)) === N);
  `);
});

test('reads the kind and further node properties', () => {
  expectBuilderTrue(`
    type U = 'a' | 'b';
    String(Reflect.getReflection(U).kind === 'union' && Reflect.getReflection(U).arms.length === 2);
  `);
  expectBuilderTrue(`
    type O = { a: uint8 };
    const n = Reflect.getReflection(O);
    String(n.kind === 'object' && n.properties[0].name === 'a');
  `);
});

test('getReflection throws on a non-Type-Object', () => {
  expectBuilderTrue(`
    let threw = false;
    try { Reflect.getReflection(5); } catch (e) { threw = true; }
    String(threw);
  `);
});
