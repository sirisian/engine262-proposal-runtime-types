import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-metadata: the `StringPattern` meta type "carries a pattern as metadata, a
 * source and flags rather than a RegExp object, so that one pattern written in
 * two modules is one type; a hook that reads it is handed a RegExp built from
 * those."
 *
 * The DECLARATION path honoured that through SnapshotMetadataValue, and the
 * `makeType` path walked the RegExp as an ordinary object instead, flattening it
 * to its own properties. So the two disagreed, which is the round trip
 * #sec-reflect-maketype exists to keep:
 *
 *   makeType({ kind: 'parameterized', base: string, metadata: { pattern: /^a+$/ } })
 *     was  string.<{ pattern: { lastIndex: 0 } }>
 *     and  !== (type string.<{ pattern: /^a+$/ }>)
 *
 * Fixed by using the canonical producer rather than a second walk of the same
 * shape - one operation knows the LEAVES of the metadata language, a pattern and
 * a range among them.
 */

const MK = 'Reflect.makeType({ kind: "parameterized", base: string, metadata: { pattern: /^a+$/ } })';

test('a pattern built by makeType is the type the annotation declares', () => {
  expect(evaluated(`String(${MK} === (type string.<{ pattern: /^a+$/ }>));`)).toBe('true');
  expect(evaluated(`String(${MK});`)).toBe('string.<{ pattern: /^a+$/ }>');
});

test('and validates through it, since it is the same type', () => {
  expect(evaluated(`let T = ${MK}; let v: T = "aaa"; String(v);`)).toBe('aaa');
  expect(evaluated(`let T = ${MK}; let m = "ok"; try { let v: T = "b"; } catch (e) { m = "refused"; } m;`)).toBe('refused');
});

test('metadata that was already canonical is unaffected', () => {
  expect(evaluated('String(Reflect.makeType({ kind: "parameterized", base: uint32,'
    + ' metadata: { brand: "UserId" } }) === (type uint32.<{ brand: "UserId" }>));')).toBe('true');
});
