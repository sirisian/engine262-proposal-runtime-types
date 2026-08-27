import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-devtools-type-inspection.md F194. `typeprogramming.md` §3.3 promises a
 * Type Object a canonical `toString` — *"the canonical source form —
 * `String(type 'a' | 'b')` is `"'a' | 'b'"` — because builders throwing authored
 * `TypeError`s need to print types"*. Nothing implemented it, so every type
 * stringified as `[object Type]`.
 */

test('F194: the canonical form is the source text, for every kind', () => {
  // The literal case is the one `displayType` gets wrong: it is a DIAGNOSTIC
  // formatter and names the KIND of thing that was wrong — "a literal type of
  // string" — which is right in an error and does not round-trip as source.
  expect(evaluated(`String(type 'a' | 'b');`)).toBe("'a' | 'b'");
  expect(evaluated('String(type 42);')).toBe('42');
  expect(evaluated('String(type { x: int32 });')).toBe('{ x: int.<32> }');
  expect(evaluated('String(type [].<uint8>);')).toBe('[].<uint.<8>>');
  expect(evaluated('String(type [uint8, string]);')).toBe('[uint.<8>, string]');
  expect(evaluated(`String(type string.<{ brand: 'B' }>);`)).toBe('string.<{ brand: "B" }>');
  expect(evaluated('String(type never);')).toBe('never');
});

test('F194: the reported program shows its type', () => {
  expect(evaluated('type A = { x: int32 }; type B = { x: null }; type C = A & B;'
    + ' String(C);')).toBe('{ x: int.<32> } & { x: null }');
});

test('F194: the canonical form is valid source that names the same type', () => {
  // The round trip is what separates a canonical form from a description: the
  // output must be text a developer can paste back.
  expect(evaluated(`type R = 'a' | 'b'; String(R === type 'a' | 'b');`)).toBe('true');
  expect(evaluated('type R = [].<uint.<8>>; String(R === type [].<uint8>);')).toBe('true');
  expect(evaluated(`type R = string.<{ brand: 'B' }>;`
    + ` String(R === type string.<{ brand: 'B' }>);`)).toBe('true');
});

test('F194: a recursive type does not hang', () => {
  // The back-edge prints as the type it closes on rather than expanding.
  expect(evaluated('type Node = { next: Node | null }; String(String(Node).length > 0);')).toBe('true');
});
