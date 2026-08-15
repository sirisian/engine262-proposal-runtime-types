import { expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule,
} from '#self';

/**
 * Shared harness for the README feature suite. Each test verifies a concrete,
 * engine-checkable part of a feature described in ecmascript-types/README.md.
 *
 * The suite is organized to mirror the README's section order, one file per run
 * of sections, so a reader can walk the proposal and the tests side by side. Where
 * a feature's full surface is out of the core engine's scope (SIMD hardware ops,
 * memory layout, and the like), the test verifies the part that is implemented and
 * says plainly, in a comment, what is deferred to an extension document.
 */

/** Run a script with the runtime-types feature on; return the raw completion. */
export function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

/** Extract the string-ish value of a normal completion (shared by the evaluators). */
function normalValueString(completion: unknown, source: string): string {
  expect(completion, `expected normal completion for: ${source}`).toMatchObject({ Type: 'normal' });
  const v = (completion as { Value: { stringValue?(): string, numberValue?(): number } }).Value;
  if (v?.stringValue) {
    return v.stringValue();
  }
  if (v?.numberValue) {
    // R asserts `instanceof NumberValue`, and this proposal's TypedNumberValue
    // is a SIBLING of NumberValue rather than a subclass, so R throws on a
    // typed number. `.numberValue()` is the reading that works for both.
    // eslint-disable-next-line @engine262/mathematical-value
    return String(v.numberValue());
  }
  return String(v);
}

/**
 * Run a script under a fixed pseudorandom seed (via HostDefined.randomSeed) and
 * return its string value. Two calls with the same seed start from the same
 * stream, so a sequence of draws is reproducible.
 */
export function evaluatedSeeded(seed: string, source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm({ randomSeed: () => seed });
  return normalValueString(realm.evaluateScriptSkipDebugger(source), source);
}

/**
 * Evaluate several scripts in order on ONE realm and return the last one's
 * string value. Because the automatic job queue drains between evaluations, an
 * earlier script may schedule microtasks (an async function's continuation, a
 * settled promise) whose effects a later reader script then observes.
 */
export function evaluatedSequence(sources: readonly string[]): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  let last = '';
  for (const source of sources) {
    last = normalValueString(realm.evaluateScriptSkipDebugger(source), source);
  }
  return last;
}

/** Run with the feature OFF (to check flag-gating and backwards compatibility). */
export function runFlagOff(source: string) {
  setSurroundingAgent(new Agent({ features: [] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

/** Evaluate to the string value of a normal completion (asserts normal). */
export function evaluated(source: string): string {
  return normalValueString(run(source), source);
}

/** True iff `source` runs to a normal completion. */
export function ok(source: string): boolean {
  return (run(source) as { Type: string }).Type === 'normal';
}

/** Assert `source` throws (a TypeError or other), i.e. is rejected at run time. */
export function expectThrown(source: string) {
  expect(run(source), `expected throw for: ${source}`).toMatchObject({ Type: 'throw' });
}

/**
 * Assert `source` is rejected STATICALLY: wrapped in a try/catch that would
 * swallow any runtime throw, the script must still fail, which only a
 * rejection before evaluation can produce. Phase 3 moved the numeric
 * library's resolution failures here from catchable runtime TypeErrors; the
 * ~any~ path keeps the runtime dispatch as the backstop, asserted separately.
 */
export function expectStaticTypeError(source: string) {
  const completion = run(`try { ${source} } catch (e) {} "ran";`) as { Type: string };
  expect(completion.Type, `expected a static rejection for: ${source}`).toBe('throw');
}

/** Assert `source` is a parse/early error under the feature (does not run). */
export function expectError(source: string) {
  const c = run(source) as { Type: string };
  expect(c.Type, `expected error (throw) for: ${source}`).toBe('throw');
}

/** Evaluate to the string value of a normal completion with the feature OFF. */
export function evaluatedFlagOff(source: string): string {
  return normalValueString(runFlagOff(source), source);
}

/**
 * Assert `source` throws, and throws the SPECIFIED KIND of error.
 *
 * Use this wherever the specification names the error, and `expectThrown` where
 * it only requires a rejection. The distinction matters: much of what the suite
 * pins is that a construct is refused, and there the kind is incidental and
 * asserting it would over-fit. But at a boundary the kind IS the specified
 * behaviour, and a test that only asks whether something threw cannot tell a
 * conforming engine from one that reports a range failure as a type failure.
 *
 * The check runs in the script rather than reading the thrown object from the
 * completion, because the error's constructor is the thing being asserted and
 * the script is where it is visible.
 */
export function expectThrownKind(source: string, kind: 'TypeError' | 'RangeError' | 'SyntaxError' | 'ReferenceError') {
  const completion = run(`try { ${source} "__did_not_throw__" } catch (e) { e.constructor.name }`) as { Type: string, Value?: { stringValue?(): string } };
  if (completion.Type !== 'normal') {
    expect.fail(`expected a catchable ${kind}, but the script did not run (an early error?): ${source}`);
  }
  expect(completion.Value?.stringValue?.(), `expected ${kind} for: ${source}`).toBe(kind);
}

/** Assert `source` throws with the feature OFF (a runtime rejection, not a parse error). */
export function expectThrownFlagOff(source: string) {
  expect(runFlagOff(source), `expected flag-off throw for: ${source}`).toMatchObject({ Type: 'throw' });
}

/** Assert `source` is an error with the feature OFF (syntax stays invalid). */
export function expectErrorFlagOff(source: string) {
  const c = runFlagOff(source) as { Type: string };
  expect(c.Type, `expected flag-off error for: ${source}`).toBe('throw');
}

/**
 * Evaluate a boolean-ish type expression to 'true'/'false'. Convention: the
 * source ends in an expression that stringifies a boolean, e.g.
 * `String(A === B)`.
 */
export function bool(source: string): boolean {
  return evaluated(source) === 'true';
}

/**
 * An agent whose host LOADS preprocessor modules, which is how
 * `sec-preprocessor-modules` says a replacement decorator is found: the module
 * is fetched and evaluated before the importing module is parsed, and the
 * decoration names one of its exports.
 *
 * The loading is SYNCHRONOUS, and may be: the graph loader is a callback machine
 * rather than an asynchronous one, so a host that calls
 * `FinishLoadingImportedModule` before returning resolves the whole graph in
 * time for the parse that is waiting on it.
 *
 * This replaces `HostResolveReplacementDecorator`, which was how the engine
 * found a macro before any of this existed and which appears nowhere in the
 * specification.
 */
export function realmWithPreprocessors(modules: Record<string, string>): ManagedRealm {
  // A holder, because the loader closes over the realm it is registered with -
  // the hook is installed before the realm exists, and answers only after it
  // does.
  const held: { realm?: ManagedRealm } = {};
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _hostDefined: unknown, payload: unknown) {
        const source = modules[request.Specifier];
        const realm = held.realm as ManagedRealm;
        const compiled = source === undefined
          ? realm.compileModule('throw new Error("no such module");')
          : realm.compileModule(source, { specifier: request.Specifier } as never);
        FinishLoadingImportedModule(referrer as never, request as never, payload as never, compiled as never);
      },
    },
  } as never));
  held.realm = new ManagedRealm();
  return held.realm;
}

/** A preprocessor module exporting one macro under `name`. */
export function preprocessorModule(name: string, body: string): string {
  return `export const ${name} = ${body};`;
}

/**
 * A realm whose host serves ONE preprocessor module, whatever specifier is asked
 * for, exporting `name` bound to `macroExpression`.
 *
 * Which specifier a fixture writes is not what these tests are about, so the
 * loader answers them all - which is also what the host hook this replaces did,
 * being asked for a decorator by name and never told where it came from.
 */
export function realmWithMacro(name: string, macroExpression: string): ManagedRealm {
  return realmWithPreprocessors(new Proxy({}, {
    get: () => `export const ${name} = ${macroExpression};`,
    has: () => true,
  }) as Record<string, string>);
}

/**
 * A realm whose one preprocessor module exports SEVERAL macros, keyed by name.
 *
 * A module may export more than one, and a fixture importing two decorations
 * from one specifier is the ordinary case rather than a special one.
 */
export function realmWithMacros(macros: Record<string, string>): ManagedRealm {
  const source = Object.keys(macros)
    .map((name) => `export const ${name} = ${macros[name]};`)
    .join('\n');
  return realmWithPreprocessors(new Proxy({}, {
    get: () => source,
    has: () => true,
  }) as Record<string, string>);
}
