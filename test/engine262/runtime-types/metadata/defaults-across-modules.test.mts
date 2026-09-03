import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule,
} from '#self';

/**
 * Spec: #sec-default-values, the realm-dependence rule -
 * "The meta types and casts declared in the surrounding realm are those
 * declared as of the operation's application ... the checking pass processes a
 * source text's `meta` declarations and its `primitive` blocks' implicit cast
 * operators before applying this operation".
 *
 * A default is now a CROSSING, and a
 * crossing consults the realm, so which declarations a realm has is part of the
 * answer. The cases a single script cannot ask: a type used inside a module at
 * all, and a cast declared by a module evaluated before the one that needs it.
 */
const NL = String.fromCharCode(10);

/** A host whose loader answers from a map, synchronously. */
function realmWithModules(modules: Record<string, string>) {
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _hostDefined: unknown, payload: unknown) {
        const source = modules[request.Specifier];
        const realm = (globalThis as { __realm?: ManagedRealm }).__realm as ManagedRealm;
        if (source === undefined) {
          FinishLoadingImportedModule(referrer as never, request as never, payload as never, realm.compileModule('throw new Error("not found");') as never);
          return;
        }
        const compiled = realm.compileModule(source, { specifier: request.Specifier } as never);
        FinishLoadingImportedModule(referrer as never, request as never, payload as never, compiled as never);
      },
    },
  } as never));
  const realm = new ManagedRealm();
  (globalThis as { __realm?: ManagedRealm }).__realm = realm;
  return realm;
}

/** Evaluates the entry module and returns what it left on `globalThis.out`. */
async function moduleOut(modules: Record<string, string>, entry: string): Promise<string> {
  const realm = realmWithModules(modules);
  const parsed = realm.compileModule(modules[entry]!, { specifier: entry } as never);
  expect((parsed as { Type?: string }).Type).not.toBe('throw');
  const settled = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 5000);
    realm.evaluateModule((parsed as unknown as { Value: never }).Value, undefined, (completion) => {
      clearTimeout(timer);
      resolve((completion as { Type?: string }).Type === 'throw' ? 'THREW' : 'evaluated');
    });
  });
  if (settled !== 'evaluated') {
    return settled;
  }
  const read = realm.evaluateScriptSkipDebugger('globalThis.out');
  const v = (read as { Value?: { stringValue?(): string } }).Value;
  return String(v?.stringValue?.() ?? v);
}

test('a type used inside a Module resolves without bringing the host down', async () => {
  // Not a metadata bug and found by looking for one. ResolveBinding defaults
  // `strict` to *false*, a Module Environment Record asserts that a read of it
  // is strict, and every type-name resolution took the default - so
  // `type X = number; let d: X;` inside a module failed an Assert rather than
  // evaluating. A script could not see it, which is why nothing did.
  expect(await moduleOut({
    './a.js': `type X = number;${NL}let d: X;${NL}globalThis.out = String(Number(d));`,
  }, './a.js')).toBe('0');
});

test('a cast declared by a module evaluated earlier admits a later module\'s default', async () => {
  // The realm-dependence rule under test. `units.js` declares the meta type and
  // the cast; `main.js` imports it, so `units.js` has evaluated by the time
  // `main.js`'s declaration asks, and the crossing finds the cast.
  const units = `type Dim = { m: number };${NL}`
    + `meta Dim { default = { m: 0 }; subtype(a, b) { return a.m === b.m; } }${NL}`
    + `primitive float64 { operator float64.<{ m: 1 }>(): float64.<{ m: 1 }> { return this; } }${NL}`
    + 'export const loaded = 1;';
  const main = `import { loaded } from './units.js';${NL}`
    + `type Meter = float64.<{ m: 1 }>;${NL}`
    + `let d: Meter;${NL}`
    + 'globalThis.out = String(Number(d) + loaded);';
  expect(await moduleOut({ './units.js': units, './main.js': main }, './main.js')).toBe('1');
});

test('primitive metadata: two meta types gate one crossing independently', () => {
  // #sec-metadata-conversion walks EACH meta type the metadata governs, so a
  // parameterization naming two is admitted only where both admit. Nothing
  // covered the multi-meta-type case before, and the two arms differ: the
  // dimension half needs a cast because `subtype` cannot admit from its
  // default, and the bound half then judges the value the cast produced.
  const dims = 'type Dim = { m: number }; '
    + 'meta Dim { default = { m: 0 }; subtype(a, b) { return a.m === b.m; } } ';
  const bounds = 'type Bnd = { lo: number }; '
    + 'meta Bnd { default = { lo: -Infinity }; subtype(a, b) { return a.lo >= b.lo; } validate(v, c) { return Number(v) >= c.lo; } } ';
  const castZero = 'primitive float64 { operator float64.<{ m: 1, lo: 0 }>(): float64.<{ m: 1, lo: 0 }> { return this; } } ';
  const castOne = 'primitive float64 { operator float64.<{ m: 1, lo: 1 }>(): float64.<{ m: 1, lo: 1 }> { return this; } } ';

  // Both admit: the cast supplies the dimension, `validate` passes the zero.
  expect(evaluated(`${dims}${bounds}${castZero} let c: float64.<{ m: 1, lo: 0 }>; String(Number(c));`)).toBe('0');
  // The bound refuses the zero, so the crossing throws and there is no default
  // even though the cast is declared - "a cast is how a value gets IN, not a
  // way past what the metadata requires".
  expectThrown(`${dims}${bounds}${castOne} let c: float64.<{ m: 1, lo: 1 }>;`);
  // And with no cast for this parameterization, the dimension half alone
  // refuses it: `subtype` does not admit an unconstrained value.
  expectThrown(`${dims}${bounds} let c: float64.<{ m: 2, lo: 0 }>;`);
});

test('primitive metadata: the no-default answer arrives from the checking pass', () => {
  // THIS IS THE DAY. The test above recorded the divergence and said what would
  // change: "#sec-type-errors makes this an Early Error found by the checking
  // pass, and this engine answers it when the declaration EVALUATES instead -
  // which is observable: a declaration inside a function that is never called
  // does not throw."
  //
  // The timing moved. The declaration is now refused whether or
  // not the function is ever called, which is what an Early Error means: "a
  // source text that contains one is rejected rather than evaluated".
  const dims = 'type Dim = { m: number }; '
    + 'meta Dim { default = { m: 0 }; subtype(a, b) { return a.m === b.m; } } '
    + 'type Meter = float64.<{ m: 1 }>; ';
  expectThrown(`${dims} function never() { let d: Meter; return d; } String("reached");`);
  expectThrown(`${dims} function never() { let d: Meter; return d; } never();`);
});
