import { test, expect } from 'vitest';
import { SerializeTypeTable, DeserializeTypeTable } from '#self';

/**
 * #sec-expansion-artifact's reference scheme: "a serialization of the interning
 * table for the concrete types a module graph's public surface produces".
 *
 * A TABLE because nothing else works. Two ordinary shapes defeat a serializer
 * that walks nested types by containment: a primitive record refers to ITSELF -
 * `getReflection(uint8).type` is `uint8` - and a recursive type closes a cycle
 * through a nested position. An entry naming another by INDEX represents both,
 * and the reader needs no cycle detection because it allocates every entry
 * before filling any.
 *
 * The walk is generic rather than a switch over kinds, so a kind added later is
 * carried without being taught. What it must NOT walk is anything that is not a
 * record: an engine `Value` walked apart loses what it was, and a parse node
 * held by a nominal record has a `parent` back-pointer and does not terminate.
 * Both were found by running this, not by reading.
 */
import { run } from '../harness.mts';
function rootsOf(program: string, names: string[]) {
  const c = run(`${program} [${names.join(',')}];`) as { Type: string, Value?: unknown };
  if (c.Type !== 'normal') return undefined;
  const arr = c.Value as { properties?: Map<unknown, { Value?: unknown }> };
  const roots = new Map<string, never>();
  const originals: unknown[] = [];
  names.forEach((n, i) => {
    const to = arr.properties?.get(String(i) as never)?.Value as { TypeRecord?: never } | undefined;
    originals.push(to);
    if (to?.TypeRecord) roots.set(n, to as never);
  });
  return { roots, originals };
}
function check(program: string, names: string[]): string {
  const r = rootsOf(program, names);
  if (!r || r.roots.size !== names.length) return 'setup failed';
  const byName = new Map<string, unknown>();
  for (const [n, to] of r.roots) byName.set(n, to);
  const back = DeserializeTypeTable(SerializeTypeTable(r.roots as never),
    (nm) => byName.get(String(nm.name)) as object | undefined);
  if (!back) return 'declined';
  return names.every((n, i) => back.get(n) === r.originals[i]) ? 'same' : 'DIFFERENT';
}
const KINDS: [string, string, string][] = [
  ['primitive', '', 'uint8'], ['literal', '', 'type "x"'],
  ['object', 'type O = { a: uint8, b: string };', 'O'],
  ['tuple', 'type T = [uint8, string];', 'T'],
  ['array', 'type A = [].<uint8>;', 'A'],
  ['union', 'type U = uint8 | string;', 'U'],
  ['intersection', 'type I = { a: uint8 } & { b: string };', 'I'],
  ['function', 'type F = (uint8) => string;', 'F'],
  ['nominal', 'class C {}', 'C'], ['enum', 'enum E { a, b }', 'E'],
  ['parameterized', 'type P = uint32.<{ brand: "X" }>;', 'P'],
  ['pattern meta', 'type Pt = string.<{ pattern: /^a$/ }>;', 'Pt'],
  ['shared', 'type S = shared uint32;', 'S'],
  ['recursive', 'type L = { next: L | void };', 'L'],
  ['nested', 'type N = { a: { b: [].<uint8> } };', 'N'],
];
for (const [n, pre, expr] of KINDS) {
  test(n, () => { expect(`${n}:${check(pre, [expr])}`).toBe(`${n}:same`); });
}
test('canonical order: the table does not depend on how roots were enumerated', () => {
  // Ordered by `orderKey`, the total order interning already sorts by, rather
  // than by first encounter from the roots. First-encounter is cheaper and lets
  // two producers over one graph emit different bytes for the same types, which
  // the hash would then call a difference. Determinism belongs to the format.
  const forward = rootsOf('type A = { a: uint8 }; type B = { b: string };', ['A', 'B'])!;
  const reverse = rootsOf('type A = { a: uint8 }; type B = { b: string };', ['B', 'A'])!;
  const shape = (m: Map<string, never>) => SerializeTypeTable(m as never)
    .types.map((e) => String((e as { Kind?: string }).Kind)).join(',');
  expect(shape(forward.roots)).toBe(shape(reverse.roots));
});

test('deterministic: the same roots twice give the same table', () => {
  const r = rootsOf('type U = { b: uint8, a: string };', ['U'])!;
  const a = JSON.stringify(SerializeTypeTable(r.roots as never).types.map((e) => Object.keys(e)));
  const b = JSON.stringify(SerializeTypeTable(r.roots as never).types.map((e) => Object.keys(e)));
  expect(a).toBe(b);
});
test('a nominal is carried by name, and nothing unencodable survives', () => {
  // Its record holds a [[Declaration]], a parse node, and a [[Constructor]], a
  // live class - measured to be the ONLY two leaves a table cannot encode, and
  // both only here. Carrying the name instead is the whole of what stands
  // between this table and bytes.
  const r = rootsOf('class User { name: string; }\nclass Account { owner: User; }\n', ['User', 'Account'])!;
  const table = SerializeTypeTable(r.roots as never);
  const unencodable: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v !== 'object' || v === null) return;
    if ((v as { $ref?: number }).$ref !== undefined) return;
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) { Object.values(v).forEach(walk); return; }
    unencodable.push(v.constructor?.name ?? '?');
  };
  table.types.forEach((e) => Object.values(e).forEach(walk));
  expect(unencodable).toEqual([]);
  const nominal = table.types.find((e) => (e as { Kind?: string }).Kind === 'nominal');
  expect((nominal as never as { nominal: { name?: string } }).nominal.name).toBe('User');
});

test('an unresolvable name is declined, as a stale hash is', () => {
  // A consumer that does not have what the artifact names cannot read the table
  // and must evaluate. Declining is the same answer a hash mismatch gets.
  const r = rootsOf('class User { name: string; }\n', ['User'])!;
  expect(DeserializeTypeTable(SerializeTypeTable(r.roots as never), () => undefined)).toBe(undefined);
});

test('a newer version is declined rather than misread', () => {
  expect(DeserializeTypeTable({ version: 999, types: [], exports: {} })).toBe(undefined);
});
