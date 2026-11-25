import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';

/**
 * Question AI, AI1: every spelling of a class behaves alike. A call on a typed class converts its
 * one argument, and a call with none or several is refused before running. That held for a
 * class declared in the module; a call through an import, a namespace or a type alias, and a
 * call on a class over a built-in, were judged only when they ran.
 */

const V = 'export class V { x: uint8 = 0; }';

test('a call on an imported typed class is judged before running', async () => {
  for (const body of ['V();', 'V(1, 2);', 'V({ x: "s" });']) {
    const result = await observeModuleGraph({ main: `import { V } from "a"; globalThis.ran = 1; ${body}`, a: V });
    expect(result, body).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError', bodyEntries: [] });
  }
  const namespace = await observeModuleGraph({ main: 'import * as m from "a"; globalThis.ran = 1; m.V();', a: V });
  expect(namespace).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError', bodyEntries: [] });
  const alias = await observeModuleGraph({ main: 'import { W } from "a"; globalThis.ran = 1; W();', a: `${V} export type W = V;` });
  expect(alias).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError', bodyEntries: [] });
  // The one-argument conversion still runs.
  for (const body of ['V({ x: 1 });', 'import * as m from "a"; m.V({ x: 1 });']) {
    const main = body.startsWith('import') ? body : `import { V } from "a"; ${body}`;
    const result = await observeModuleGraph({ main, a: V });
    expect(result, body).toMatchObject({ status: 'fulfilled' });
  }
});

test('a call on an imported function is not read as a class', async () => {
  // Only an imported alias names a type; an imported function, applied or
  // called inside a predicate, is a value as before.
  const dep = 'export function g<T: type>(v: T): T { return v; } export function ok(n: uint32): boolean { return n > 1; }';
  for (const main of [
    'import { g } from "dep"; if (g.<number>(1) !== 1) throw new Error("g");',
    'import { ok } from "dep"; type B<N: uint32> = uint32 where ok(N); function u<N: uint32>() { B.<N>; }',
  ]) {
    expect(await observeModuleGraph({ dep, main }), main).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  }
});

test('a call on an alias of a class with no argument or several is refused before running', () => {
  const C = 'class V { x: uint8 = 0; } type W = V; ';
  for (const call of ['W();', 'W(1, 2);', 'W({ x: 1 }, 2);']) {
    expectStaticTypeError(`${C}${call}`);
  }
  expect(evaluated(`${C}String(W({ x: 1 }).x);`)).toBe('1');
  const B = 'class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } type B8 = Box.<uint8>; ';
  expectStaticTypeError(`${B}B8();`);
  expect(evaluated(`${B}String(B8(1).v);`)).toBe('1');
});

test('a class over a built-in that participates is called as a type is, and refuses what := refuses', () => {
  // Annotated on a method, the class participates (Question BV, BV2), so `E(1)`
  // is `1 := E`, which converts nothing to it and throws when it runs, as `:=`
  // does. A built-in participates in nothing, so a class over one that
  // participates in nothing keeps JavaScript's TypeError.
  for (const declaration of ['class E extends Error { m(): uint8 { return 1; } }', 'class E extends Map { m(): uint8 { return 1; } }']) {
    expect(evaluated(`${declaration} try { E(1); "converted"; } catch (e) { e.message; }`)).toBe('1 is not assignable to "E"');
    expect(evaluated(`${declaration} try { (1 := E); "converted"; } catch (e) { e.message; }`)).toBe('1 is not assignable to "E"');
  }
  expect(evaluated('class E extends Error { } try { E(1); "converted"; } catch (e) { e.message; }')).toContain('cannot be invoked without new');
  // With a typed field it is a typed class, and the call converts, as `:=` does.
  expect(evaluated('class E extends Error { code: uint8 = 0; } try { E({ code: 1 }); "converted"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('new of an alias of an array type constructs the array', () => {
  expect(evaluated('type A4 = [4].<uint8>; const a = new A4(); String(a.length) + " " + String(Reflect.typeOf(a));')).toBe('4 [4].<uint.<8>>');
  expect(evaluated('type A4 = [4].<uint8>; String(new A4([1, 2, 3, 4])[3]);')).toBe('4');
  expect(evaluated('type A = [].<uint8>; String(new A().length);')).toBe('0');
  expect(evaluated('type A4 = [4].<uint8>; let a: [4].<uint8> = new A4(); String(a.length);')).toBe('4');
});
