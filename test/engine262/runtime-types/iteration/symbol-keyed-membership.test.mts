import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * FINDING H (open): symbol-keyed structural membership fails.
 *
 * Spec: #sec-isoftype (structural membership reads the value's properties),
 * #sec-iteration-types.
 *
 * `IsOfType` checks an ~object~ type by asking HasProperty and Get for each
 * property of the type. That works for a string key and fails for a SYMBOL one,
 * so every type whose shape names `[Symbol.iterator]` refuses values that
 * satisfy it:
 *
 *   - `Iterator.<uint8>`, whose properties are `next`, `return`, `throw`, all
 *     string keys, ACCEPTS a hand-built iterator and a generator object.
 *   - `Iterable.<uint8>` and `IterableIterator.<uint8>`, which add the
 *     `[Symbol.iterator]` property, REFUSE the same values - and refuse a plain
 *     Array, a typed `[].<uint8>`, and a `do *` generator too.
 *
 * The value really is iterable: `for`-`of` walks it, and reading
 * `x[Symbol.iterator]` gives a function. Only the membership check disagrees.
 *
 * This was invisible until the elision-stability rule of #sec-elision-stability
 * landed, because the boundary that would have run this check was elided
 * wherever the static type was already assignable. Two tests in this suite were
 * passing for that reason rather than because the check succeeded. It is a
 * pre-existing defect and not a consequence of that rule: forcing the same
 * check through an ~any~-typed path fails identically, which is what these
 * cases do.
 *
 * Recorded with `test.fails` so that it is a live reproduction rather than a
 * comment: when the defect is fixed these turn red and are rewritten as
 * ordinary assertions.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

// The half that works, kept beside the half that does not so the difference is
// the key rather than anything else: same value, same function-typed property
// checks, string keys only.
test('a string-keyed shape is checked correctly', () => {
  expectOk(`const it = { next() { return { value: (1 := uint8), done: false }; } };
    function anyv(x) { return x; }
    const i: Iterator.<uint8> = anyv(it);`);
  expectOk(`function* g(): uint8 { yield 1; }
    function anyv(x) { return x; }
    const i: Iterator.<uint8> = anyv(g());`);
});

test('the value is iterable in fact', () => {
  expectOk(`const it = { [Symbol.iterator]() { return { next() { return { value: 1, done: true }; } }; } };
    for (const v of it) { }`);
  expectOk("function* g(): uint8 { yield 1; } const x = g(); if (typeof x[Symbol.iterator] !== 'function') { throw new Error('x'); }");
});

test.fails('a symbol-keyed shape refuses a value that satisfies it (hand-built)', () => {
  expectOk(`const it = { [Symbol.iterator]() { return { next() { return { value: (1 := uint8), done: false }; } }; } };
    function anyv(x) { return x; }
    const i: Iterable.<uint8> = anyv(it);`);
});

test.fails('a symbol-keyed shape refuses a generator object', () => {
  expectOk(`function* g(): uint8 { yield 1; }
    function anyv(x) { return x; }
    const i: Iterable.<uint8> = anyv(g());`);
});

test.fails('a symbol-keyed shape refuses an array', () => {
  expectOk(`let a: [].<uint8> = [1];
    function anyv(x) { return x; }
    const i: Iterable.<uint8> = anyv(a);`);
});

test.fails('IterableIterator refuses what Iterator accepts, the difference being the symbol key', () => {
  expectOk(`const it = { next() { return { value: (1 := uint8), done: false }; }, [Symbol.iterator]() { return this; } };
    function anyv(x) { return x; }
    const i: IterableIterator.<uint8> = anyv(it);`);
});
