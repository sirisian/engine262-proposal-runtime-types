import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * FINDING H (fixed): the iteration interfaces are satisfied structurally.
 *
 * Spec: #sec-isoftype (structural membership reads the value's properties),
 * #sec-iteration-types.
 *
 * `Iterable`, `IterableIterator`, `IteratorResult`, and their async forms were
 * listed BOTH as structural iteration interfaces and as nominal library types.
 * The two resolution chains disagree on which wins: the checker reaches
 * iterationInterfaceRecord before libraryTypeRecord, and the runtime reaches it
 * after. So one annotation meant two things - a structural shape statically, an
 * identity dynamically - and every value that satisfied the shape without being
 * built as the library type was refused at the boundary:
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
 * `Iterator` was never in the nominal list, which is why it always worked and
 * is what made the difference legible: the comment beside that list already
 * said `Iterator.<T>` "stays the interface, so a hand-written iterator still
 * satisfies it". The same is true of the rest, and both paths now agree.
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

test('a hand-built iterable satisfies Iterable', () => {
  expectOk(`const it = { [Symbol.iterator]() { return { next() { return { value: (1 := uint8), done: false }; } }; } };
    function anyv(x) { return x; }
    const i: Iterable.<uint8> = anyv(it);`);
});

test('a generator object satisfies Iterable', () => {
  expectOk(`function* g(): uint8 { yield 1; }
    function anyv(x) { return x; }
    const i: Iterable.<uint8> = anyv(g());`);
});

test('an array satisfies Iterable', () => {
  expectOk(`let a: [].<uint8> = [1];
    function anyv(x) { return x; }
    const i: Iterable.<uint8> = anyv(a);`);
});

test('IterableIterator accepts what satisfies both halves', () => {
  expectOk(`const it = { next() { return { value: (1 := uint8), done: false }; }, [Symbol.iterator]() { return this; } };
    function anyv(x) { return x; }
    const i: IterableIterator.<uint8> = anyv(it);`);
});
