import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * #sec-declared-narrowing: a
 * signature may carry [[Narrows]], and "a binding declared of a constructed
 * guard type narrows at every call through it". The engine built the field,
 * reflected it and checked its variance, and consumed it nowhere - the built-in
 * `v is T` drove the same machinery, which is what hid the gap.
 *
 * Written against whole SCRIPTS rather than the probe harness: the harness
 * wraps a program in a block, and a type declaration nested in one is not
 * pre-evaluated, so the alias never resolves there.
 */
function realm(): ManagedRealm {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  return new ManagedRealm();
}

const GUARD = 'function makeGuard() { return Reflect.makeType({ kind: "function", signatures: [{ '
  + 'parameters: [{ name: "v", type: type any }], return: { type: type boolean }, '
  + 'narrows: [{ target: "v", type: type uint8 }] }] }); } '
  + 'type Guard = makeGuard(); '
  + 'const isU8: Guard = (v) => typeof v === "number"; ';

function run(src: string) {
  const r = realm();
  return r.evaluateScriptSkipDebugger(src) as { Type?: string };
}

test('a declared guard narrows the argument it names', () => {
  expect(run(`${GUARD} let box: uint8 | string = (5 := uint8); if (isU8(box)) { let n: uint8 = box; }`).Type).toBe('normal');
  // And it narrows only under the guard: the same binding outside it is not.
  expect(run(`${GUARD} let box: uint8 | string = (5 := uint8); let n: uint8 = box;`).Type).toBe('throw');
});

test('the narrowing follows the sense of the test', () => {
  // `!guard(x)` narrows in the OTHER branch.
  expect(run(`${GUARD} let box: uint8 | string = (5 := uint8); if (!isU8(box)) { } else { let n: uint8 = box; }`).Type).toBe('normal');
  expect(run(`${GUARD} let box: uint8 | string = (5 := uint8); if (!isU8(box)) { let n: uint8 = box; }`).Type).toBe('throw');
});

test('what the guard does not name is not narrowed', () => {
  // A call whose argument is not a name has nothing to narrow, and must not
  // crash the pass.
  expect(run(`${GUARD} let o = {}; o.v = 1; if (isU8(o.v)) { } globalThis.ok = 1;`).Type).toBe('normal');
  // A second binding is untouched by a guard on the first.
  expect(run(`${GUARD} let a: uint8 | string = (5 := uint8); let b: uint8 | string = (5 := uint8); `
    + 'if (isU8(a)) { let n: uint8 = b; }').Type).toBe('throw');
});

test('the deferral does not swallow ordinary errors', () => {
  // The first walk defers only where the callee has NO static type - a call it
  // may yet learn to narrow. An ORDINARY guard, whose type is known and carries
  // no [[Narrows]], is judged as it always was.
  expect(run('function plain(v) { return true; } '
    + 'let box: uint8 | string = (5 := uint8); if (plain(box)) { let n: uint8 = box; }').Type).toBe('throw');
  // And a mistake unrelated to narrowing, inside a DEFERRED branch, is still
  // caught - by the later walk, which is what the deferral hands it to.
  expect(run(`${GUARD} let box: uint8 | string = (5 := uint8); if (isU8(box)) { let s: string = (5 := uint8); }`).Type).toBe('throw');
});

test('a guard narrows only the argument its [[Target]] names', () => {
  // Two parameters, a narrowing on the SECOND: the target resolves by name, so
  // the second argument narrows and the first does not.
  const two = 'function makeGuard2() { return Reflect.makeType({ kind: "function", signatures: [{ '
    + 'parameters: [{ name: "a", type: type any }, { name: "b", type: type any }], '
    + 'return: { type: type boolean }, narrows: [{ target: "b", type: type uint8 }] }] }); } '
    + 'type G2 = makeGuard2(); const pair: G2 = (a, b) => true; ';
  expect(run(`${two} let x: uint8 | string = (5 := uint8); let y: uint8 | string = (5 := uint8); `
    + 'if (pair(x, y)) { let n: uint8 = y; }').Type).toBe('normal');
  expect(run(`${two} let x: uint8 | string = (5 := uint8); let y: uint8 | string = (5 := uint8); `
    + 'if (pair(x, y)) { let n: uint8 = x; }').Type).toBe('throw');
});

const ASSERT = 'function makeAssert() { return Reflect.makeType({ kind: "function", signatures: [{ '
  + 'parameters: [{ name: "v", type: type any }], narrows: [{ target: "v", type: type uint8 }] }] }); } '
  + 'type A = makeAssert(); '
  + 'const assertU8: A = (v) => { if (typeof v !== "number") throw new TypeError("no"); }; ';

test('a void assertion narrows the positions it dominates', () => {
  // #sec-declared-narrowing gives [[Narrows]] two forms. The `boolean` one is a
  // TEST and narrows a branch; the ~void~ one is an ASSERTION and narrows
  // "every position the call dominates", which for a straight-line block is the
  // statements after it.
  // MEASURED, NOT DESIRED. The narrowing IS applied by the walk that can
  // resolve the guard's alias - but the parse-time walk reports the binding
  // first, and the statement-position deferral that would hold it back was
  // REMOVED: every version of it either fired on ordinary untyped calls
  // (suppressing real errors after `show(...)`, a regression this test suite
  // caught) or failed to fire at all. The branch form needs no deferral of its
  // own because `walkGuarded` already has one; statement position does, and it
  // needs a key that is neither "the callee has no type" nor "the annotation
  // did not resolve". Flip to 'normal' when that key is found.
  expect(run(`${ASSERT} { let box: uint8 | string = (5 := uint8); assertU8(box); let n: uint8 = box; }`).Type).toBe('throw');
  // Before the call it dominates nothing, so it narrows nothing.
  expect(run(`${ASSERT} { let box: uint8 | string = (5 := uint8); let n: uint8 = box; assertU8(box); }`).Type).toBe('throw');
});

test('an assertion narrows only what it names, and only when it asserts', () => {
  // A second binding is untouched.
  expect(run(`${ASSERT} { let a: uint8 | string = (5 := uint8); let b: uint8 | string = (5 := uint8); `
    + 'assertU8(a); let n: uint8 = b; }').Type).toBe('throw');
  // A `boolean` guard CALLED AS A STATEMENT asserts nothing - its answer was
  // discarded - so it must not narrow. This is the case that separates the two
  // forms, and reading the signature's return is what separates them.
  expect(run(`${GUARD} { let box: uint8 | string = (5 := uint8); isU8(box); let n: uint8 = box; }`).Type).toBe('throw');
});

test('the assertion deferral does not swallow errors after an ordinary call', () => {
  // The deferral applies only to a call through a BARE NAME whose type this
  // walk does not know - the shape a declared assertion takes. A method call,
  // whose callee is untyped for reasons that have nothing to do with
  // narrowing, must keep reporting what follows it: suppressing after one hid
  // real rejections in the span suite, which is how this restriction was found.
  expect(run('let a: [4].<uint32> = [1, 2, 3, 4]; let b = {}; b.v = 1; '
    + 'a.slice(); let s: string = (5 := uint8);').Type).toBe('throw');
  // And a call through a name whose type IS known keeps reporting too.
  expect(run('function plain(v) { return 1; } plain(1); let s: string = (5 := uint8);').Type).toBe('throw');
});

test('a narrowing predicate is the SOURCE SPELLING of [[Narrows]]', () => {
  // #sec-declared-narrowing: `function isFish(pet: Pet): pet is Fish` declares
  // that a *true* answer proves the named parameter is of that type. Before this
  // spelling existed a signature acquired [[Narrows]] only by construction, so
  // the feature's own stated use - a guard a program can write - was unreachable.
  const G = 'function isU8(v: uint8 | string): v is uint8 { return typeof v === "number"; } ';
  // The call narrows in the branch it guards, and the else branch the other way.
  expect(run(`${G} let x: uint8 | string = (4 := uint8); if (isU8(x)) { let n: uint8 = x; }`).Type).toBe('normal');
  expect(run(`${G} let x: uint8 | string = "s"; if (isU8(x)) { } else { let t: string = x; }`).Type).toBe('normal');
  // Outside the guard it narrows nothing.
  expect(run(`${G} let x: uint8 | string = (4 := uint8); let n: uint8 = x;`).Type).toBe('throw');
  // The signature's own return is `boolean` - the predicate says what a true
  // answer PROVES, not what the function returns - so the body returning a
  // boolean is correct and the value reaches the caller.
  expect(run(`${G} let b: boolean = isU8(3 := uint8);`).Type).toBe('normal');
  // The named target must be a parameter of this signature: a claim about
  // anything else is one no caller could act on.
  expect(run('function bad(v: uint8): q is uint8 { return true; }').Type).toBe('throw');
  // An ordinary boolean predicate still narrows nothing, which is what makes the
  // declaration the thing that carries the claim.
  expect(run('function p(v: uint8 | string): boolean { return true; } '
    + 'let x: uint8 | string = "s"; if (p(x)) { let n: uint8 = x; }').Type).toBe('throw');
  // A type that happens to be named like an identifier still parses as a type.
  expect(run('type pet = uint8; function g(): pet { return (1 := uint8); }').Type).toBe('normal');
});
