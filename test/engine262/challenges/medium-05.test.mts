import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges — the medium tier, shard 5: the property-modifier family.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * These all turn on the `readonly` property modifier, built this shard: the
 * object record now carries a readonly flag, the parser accepts the modifier
 * (while `readonly` stays a valid property NAME), and the flag participates in
 * interning (readonly and mutable objects are distinct types) and reflection.
 * mapProperties over getReflection sets or clears the flag; `type 'name'` names
 * the key set via the literal type operator.
 */

const KIT = `
function mapProperties(T, f) { return Reflect.makeType({ kind: 'object', properties: Reflect.getReflection(T).properties.map(f), indexSignatures: [] }); }
function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
function readonly(T) { return mapProperties(T, p => ({ ...p, readonly: true })); }
function mutable(T) { return mapProperties(T, p => ({ ...p, readonly: false })); }
function partial(T) { return mapProperties(T, p => ({ ...p, optional: true })); }
function required(T) { return mapProperties(T, p => ({ ...p, optional: false })); }
function arms(T) { const n = Reflect.getReflection(T); return n.kind === 'union' ? n.arms : [T]; }
function keyVals(K) { return new Set(arms(K).map(a => Reflect.getReflection(a).value)); }
`;
const kit = (p: string) => `${KIT}\n${p}`;

// 7 · Readonly — mark every property readonly.
test('medium 7 · Readonly', () => {
  expectBuilderTrue(kit(`
    type Todo = { title: string, description: string, completed: boolean };
    type Expected = { readonly title: string, readonly description: string, readonly completed: boolean };
    String(readonly(Todo) === Expected);
  `));
});

// 2793 · Mutable — strip readonly. readonly then mutable is the identity.
test('medium 2793 · Mutable', () => {
  expectBuilderTrue(kit(`
    type Todo = { title: string, done: boolean };
    String(mutable(readonly(Todo)) === Todo);
  `));
  expectBuilderTrue(kit(`
    type RO = { readonly a: uint8, readonly b: string };
    type Expected = { a: uint8, b: string };
    String(mutable(RO) === Expected);
  `));
});

// 8 · Readonly 2 — mark only the named keys readonly; the default is all keys.
test('medium 8 · Readonly 2', () => {
  const f = `${KIT}
    function readonly2(T, K) {
      const keys = keyVals(K);
      return mapProperties(T, p => keys.has(p.name) ? { ...p, readonly: true } : p);
    }`;
  expectBuilderTrue(`${f}
    type Todo = { title: string, description: string, completed: boolean };
    type Keys = 'title' | 'description';
    type Expected = { readonly title: string, readonly description: string, completed: boolean };
    String(readonly2(Todo, Keys) === Expected);
  `);
  // the default parameter (all keys) equals plain readonly
  expectBuilderTrue(`${f}
    function readonlyAll(T) { return readonly(T); }
    type Todo = { title: string, done: boolean };
    type AllKeys = keyof Todo;
    String(readonly2(Todo, AllKeys) === readonly(Todo));
  `);
});

// 2757 · PartialByKeys — make only the named keys optional; default is all.
test('medium 2757 · PartialByKeys', () => {
  const f = `${KIT}
    function partialByKeys(T, K) {
      const keys = keyVals(K);
      return mapProperties(T, p => keys.has(p.name) ? { ...p, optional: true } : p);
    }`;
  expectBuilderTrue(`${f}
    type User = { name: string, age: uint32, address: string };
    type Expected = { name?: string, age: uint32, address: string };
    String(partialByKeys(User, type 'name') === Expected);
  `);
  expectBuilderTrue(`${f}
    type User = { name: string, age: uint32, address: string };
    type Keys = 'name' | 'age';
    type Expected = { name?: string, age?: uint32, address: string };
    String(partialByKeys(User, Keys) === Expected);
  `);
});

// 2759 · RequiredByKeys — make only the named keys required; default is all.
test('medium 2759 · RequiredByKeys', () => {
  const f = `${KIT}
    function requiredByKeys(T, K) {
      const keys = keyVals(K);
      return mapProperties(T, p => keys.has(p.name) ? { ...p, optional: false } : p);
    }`;
  expectBuilderTrue(`${f}
    type User = { name?: string, age?: uint32, address?: string };
    type Expected = { name: string, age?: uint32, address?: string };
    String(requiredByKeys(User, type 'name') === Expected);
  `);
});

// 3 · Omit (readonly-preserving form) — the corpus's Omit keeps `readonly title`
// readonly. Now that the flag round-trips, the full expected type is asserted.
test('medium 3 · Omit (readonly-preserving)', () => {
  expectBuilderTrue(kit(`
    function omit(T, K) {
      const keys = keyVals(K);
      return objectOf(Reflect.getReflection(T).properties.filter(p => !keys.has(p.name)));
    }
    type Todo = { readonly title: string, description: string, completed: boolean };
    type Expected = { readonly title: string, completed: boolean };
    String(omit(Todo, type 'description') === Expected);
  `));
  expectBuilderTrue(kit(`
    function omit(T, K) {
      const keys = keyVals(K);
      return objectOf(Reflect.getReflection(T).properties.filter(p => !keys.has(p.name)));
    }
    type Todo = { readonly title: string, description: string, completed: boolean };
    type Keys = 'description' | 'completed';
    type Expected = { readonly title: string };
    String(omit(Todo, Keys) === Expected);
  `));
});
