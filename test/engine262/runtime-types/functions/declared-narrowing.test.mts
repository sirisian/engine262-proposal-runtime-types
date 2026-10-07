import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// #sec-declared-narrowing: use open parameter domains so the guard supplies
// the fact under test. A known initializer already narrows its stored value.
const scoped = (setup: string, body: string, parameters = 'box: uint8 | string') =>
  `${setup} function check(${parameters}) { ${body} }`;

const GUARD = 'function makeGuard() { return Reflect.makeType({ kind: "function", signatures: [{ '
  + 'parameters: [{ name: "v", type: type any }], return: { type: type boolean }, '
  + 'narrows: [{ target: "v", type: type uint8 }] }] }); } '
  + 'type Guard = makeGuard(); '
  + 'const isU8: Guard = (v) => typeof v === "number"; ';

test('a declared guard narrows the argument it names', () => {
  expect(ok(scoped(GUARD, 'if (isU8(box)) { let n: uint8 = box; }'))).toBe(true);
  // And it narrows only under the guard: the same binding outside it is not.
  expectStaticTypeError(scoped(GUARD, 'let n: uint8 = box;'));
});

test('the narrowing follows the sense of the test', () => {
  // `!guard(x)` narrows in the OTHER branch.
  expect(ok(scoped(GUARD, 'if (!isU8(box)) { } else { let n: uint8 = box; }'))).toBe(true);
  expectStaticTypeError(scoped(GUARD, 'if (!isU8(box)) { let n: uint8 = box; }'));
});

test('what the guard does not name is not narrowed', () => {
  // A call whose argument is not a name has nothing to narrow, and must not
  // crash the pass.
  expect(ok(scoped(GUARD, 'let o = {}; o.v = 1; if (isU8(o.v)) { } globalThis.ok = 1;'))).toBe(true);
  // A second binding is untouched by a guard on the first.
  expectStaticTypeError(scoped(GUARD, 'if (isU8(a)) { let n: uint8 = b; }', 'a: uint8 | string, b: uint8 | string'));
});

test('the deferral does not swallow ordinary errors', () => {
  // The first walk defers only where the callee has NO static type - a call it
  // may yet learn to narrow. An ORDINARY guard, whose type is known and carries
  // no [[Narrows]], is judged as it always was.
  expectStaticTypeError(scoped('function plain(v) { return true; }', 'if (plain(box)) { let n: uint8 = box; }'));
  // And a mistake unrelated to narrowing, inside a DEFERRED branch, is still
  // caught - by the later walk, which is what the deferral hands it to.
  expectStaticTypeError(scoped(GUARD, 'if (isU8(box)) { let s: string = (5 := uint8); }'));
});

test('a guard narrows only the argument its [[Target]] names', () => {
  // Two parameters, a narrowing on the SECOND: the target resolves by name, so
  // the second argument narrows and the first does not.
  const two = 'function makeGuard2() { return Reflect.makeType({ kind: "function", signatures: [{ '
    + 'parameters: [{ name: "a", type: type any }, { name: "b", type: type any }], '
    + 'return: { type: type boolean }, narrows: [{ target: "b", type: type uint8 }] }] }); } '
    + 'type G2 = makeGuard2(); const pair: G2 = (a, b) => true; ';
  expect(ok(scoped(two, 'if (pair(x, y)) { let n: uint8 = y; }', 'x: uint8 | string, y: uint8 | string'))).toBe(true);
  expectStaticTypeError(scoped(two, 'if (pair(x, y)) { let n: uint8 = x; }', 'x: uint8 | string, y: uint8 | string'));
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
  expect(ok(scoped(ASSERT, '{ assertU8(box); let n: uint8 = box; }'))).toBe(true);
  // Before the call it dominates nothing, so it narrows nothing.
  expectStaticTypeError(scoped(ASSERT, '{ let n: uint8 = box; assertU8(box); }'));
});

test('an assertion narrows only what it names, and only when it asserts', () => {
  // A second binding is untouched.
  expectStaticTypeError(scoped(ASSERT, '{ assertU8(a); let n: uint8 = b; }', 'a: uint8 | string, b: uint8 | string'));
  // A `boolean` guard CALLED AS A STATEMENT asserts nothing - its answer was
  // discarded - so it must not narrow. This is the case that separates the two
  // forms, and reading the signature's return is what separates them.
  expectStaticTypeError(scoped(GUARD, '{ isU8(box); let n: uint8 = box; }'));
});

test('the assertion deferral does not swallow errors after an ordinary call', () => {
  // The deferral applies only to a call through a BARE NAME whose type this
  // walk does not know - the shape a declared assertion takes. A method call,
  // whose callee is untyped for reasons that have nothing to do with
  // narrowing, must keep reporting what follows it: suppressing after one hid
  // real rejections in the span suite, which is how this restriction was found.
  expectStaticTypeError('let a: [4].<uint32> = [1, 2, 3, 4]; let b = {}; b.v = 1; '
    + 'a.slice(); let s: string = (5 := uint8);');
  // And a call through a name whose type IS known keeps reporting too.
  expectStaticTypeError('function plain(v) { return 1; } plain(1); let s: string = (5 := uint8);');
});

test('a narrowing predicate is the SOURCE SPELLING of [[Narrows]]', () => {
  // #sec-declared-narrowing: `function isFish(pet: Pet): pet is Fish` declares
  // that a *true* answer proves the named parameter is of that type. Before this
  // spelling existed a signature acquired [[Narrows]] only by construction, so
  // the feature's own stated use - a guard a program can write - was unreachable.
  const G = 'function isU8(v: uint8 | string): v is uint8 { return typeof v === "number"; } ';
  // The call narrows in the branch it guards, and the else branch the other way.
  expect(ok(scoped(G, 'if (isU8(x)) { let n: uint8 = x; }', 'x: uint8 | string'))).toBe(true);
  expect(ok(scoped(G, 'if (isU8(x)) { } else { let t: string = x; }', 'x: uint8 | string'))).toBe(true);
  // Outside the guard it narrows nothing.
  expectStaticTypeError(scoped(G, 'let n: uint8 = x;', 'x: uint8 | string'));
  // The signature's own return is `boolean` - the predicate says what a true
  // answer PROVES, not what the function returns - so the body returning a
  // boolean is correct and the value reaches the caller.
  expect(evaluated(`${G} String(isU8(3 := uint8));`)).toBe('true');
  // The named target must be a parameter of this signature: a claim about
  // anything else is one no caller could act on.
  expectStaticTypeError('function bad(v: uint8): q is uint8 { return true; }');
  // An ordinary boolean predicate still narrows nothing, which is what makes the
  // declaration the thing that carries the claim.
  expectStaticTypeError(scoped('function p(v: uint8 | string): boolean { return true; }',
    'if (p(box)) { let n: uint8 = box; }'));
  // A type that happens to be named like an identifier still parses as a type.
  expect(ok('type pet = uint8; function g(): pet { return (1 := uint8); }')).toBe(true);
});
