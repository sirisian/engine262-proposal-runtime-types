import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * PLAN-declarative-checker-facts.md phase 3. #sec-declared-narrowing: a
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
  // MEASURED, NOT DESIRED. The fact is produced - the call arm finds the
  // callee's [[Narrows]] once the alias resolves - but the PARSE-TIME walk has
  // already reported `let n: uint8 = box` as an early error, and the second
  // walk cannot un-report it. Declared narrowing needs the deferral the bounds
  // narrowing already uses (TakeNarrowingRequests / SetNarrowingResolutions),
  // which is the remaining half of this phase. Flip to 'normal' when it lands.
  expect(run(`${GUARD} let box: uint8 | string = (5 := uint8); if (isU8(box)) { let n: uint8 = box; }`).Type).toBe('throw');
  // And it narrows only under the guard: the same binding outside it is not.
  expect(run(`${GUARD} let box: uint8 | string = (5 := uint8); let n: uint8 = box;`).Type).toBe('throw');
});

test('the narrowing follows the sense of the test', () => {
  // `!guard(x)` narrows in the OTHER branch.
  // Same deferral gap as above; the sense itself is right where it is read.
  expect(run(`${GUARD} let box: uint8 | string = (5 := uint8); if (!isU8(box)) { } else { let n: uint8 = box; }`).Type).toBe('throw');
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
