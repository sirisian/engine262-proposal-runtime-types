import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * `#sec-type-name-resolution`: a built-in type name resolves "through the ordinary
 * scope chain first and through the built-in table only where no user binding of
 * the name exists".
 *
 * The checker was given a registry keyed by the WRITTEN NAME that never
 * consulted scope, so under a shadow the checker answered with the intrinsic
 * while the runtime, which walks the scope chain, answered with the binding. The
 * two disagreed about what an annotation MEANS - the very defect the registry
 * existed to remove, reintroduced by it, and not caught by the parity test, which asks whether a kind resolves rather than whether it
 * resolves to the same thing.
 *
 * The probes below separate the two judges. A value whose static type the checker
 * knows is judged by the CHECKER, before evaluation. An `any`-typed value defers,
 * so the RUNTIME resolves the annotation. Where a name is shadowed they must
 * agree, and the way they agree is that the checker declines to answer: it cannot
 * know what a value binding holds, and the runtime boundary already resolves it.
 */
function run(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }) as never);
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source) as unknown as {
    Type: string, Value?: { stringValue?(): string },
  };
  return completion.Type === 'throw' ? 'EARLY' : String(completion.Value?.stringValue?.() ?? '?');
}

/** What the CHECKER says: a bad initializer in a function that is never called. */
const checker = (setup: string, ty: string) => (run(`${setup}function never() { let v: ${ty} = 5; } "ran";`) === 'EARLY' ? 'refuses' : 'allows');

/** What the RUNTIME says: an `any` value, so the checker cannot judge it. */
const runtime = (setup: string, ty: string) => run(`${setup}let x: any = 5; try { let v: ${ty} = x; "allows" } catch (e) { "refuses" }`);

const CASES: readonly (readonly [string, string, string])[] = [
  ['a bare intrinsic name', 'const Token = uint8; ', 'Token'],
  ['a metadata interface', 'const ClassMetadata = uint8; ', 'ClassMetadata'],
  ['a qualified name, shadowed at the BASE', 'const Reflect = { Block: uint8 }; ', 'Reflect.Block'],
];

test('a program binding shadows an intrinsic type name, and both judges agree', () => {
  for (const [label, setup, ty] of CASES) {
    expect(checker(setup, ty), `checker, ${label}`).toBe('allows');
    expect(runtime(setup, ty), `runtime, ${label}`).toBe('allows');
  }
});

test('with no shadow the intrinsic is used, and both judges still agree', () => {
  // The guard against fixing the divergence by disabling the registry:
  // unshadowed, these must still resolve.
  for (const [label, , ty] of CASES) {
    expect(checker('', ty), `checker, unshadowed ${label}`).toBe('refuses');
    expect(runtime('', ty), `runtime, unshadowed ${label}`).toBe('refuses');
  }
});

test('the shadow is found even when its TYPE is unknown to the checker', () => {
  // `const Token = uint8;` binds the name and tells the checker nothing about
  // what it holds. Asking the binding TYPE table answers false for exactly these
  // - the shadows that matter most - so the check reads the declared NAMES.
  expect(checker('const Token = uint8; ', 'Token')).toBe('allows');
  expect(checker('let Token; ', 'Token')).toBe('allows');
  expect(checker('function Token() {} ', 'Token')).toBe('allows');
});
