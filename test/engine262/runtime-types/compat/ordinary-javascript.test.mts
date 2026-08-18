import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * proposal-runtime-types: ORDINARY JAVASCRIPT is unaffected by this proposal.
 *
 * The mechanism that makes this true is structural rather than lucky: the
 * typing applies at the [[Get]] of a value carrying [[TypedElement]], so code
 * that does not use the new syntax cannot reach it. But nothing pinned it, and
 * every other test in the suite runs with the feature ON, so a regression here
 * is exactly the kind the rest of the suite cannot see.
 *
 * The check is a COMPARISON, flag-on against flag-off, rather than an assertion
 * about an expected value. Asserting a value tests a guess about what
 * JavaScript does; comparing the two runs tests that the proposal left it
 * alone, which is the actual requirement.
 */
function evaluate(source: string, features: readonly string[]): string {
  setSurroundingAgent(new Agent({ features }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source);
  if (completion.Type !== 'normal') {
    return `THREW ${(completion.Value as { constructor: { name: string } }).constructor.name}`;
  }
  const value = completion.Value as { stringValue?(): string };
  return value.stringValue ? value.stringValue() : String(value);
}

/** The same source with the feature on and off must agree. */
function agrees(source: string): void {
  const on = evaluate(source, ['runtime-types']);
  const off = evaluate(source, []);
  expect(on, `flag-on and flag-off disagree for: ${source}`).toBe(off);
}

test('a plain array behaves identically with the feature on and off', () => {
  for (const source of [
    'const a = [1, 2, 3]; String(a.length);',
    'const a = [1, 2, 3]; String(a.length - 1);',
    'const a = []; String(a.length - 1);',
    'const a = [1, 2, 3]; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; } String(s);',
    'const a = [1, 2, 3]; let o = ""; for (let i = a.length - 1; i >= 0; i--) { o += a[i]; } o;',
    'const a = [1, 2, 3]; let n = 0; a.forEach(() => { n += 1; }); String(n);',
    'const a = [1, 2, 3]; String(a.map((x) => x * 2).filter((x) => x > 2).length);',
    'const a = [1]; a.push(2); a.pop(); String(a.length);',
    'const a = [1, 2, 3]; a.length = 1; String(a.length);',
    'const a = [1, 2, 3]; a.slice(1).join(",");',
    'const a = [1, 2, 3]; String(a[99]);',
    'const a = [1, 2, 3]; let n = 3; String(a.length === n);',
  ]) {
    agrees(source);
  }
});

test('a TypedArray behaves identically with the feature on and off', () => {
  // The deprecation of #sec-relationship-to-typed-arrays changes nothing a
  // program can see. This is the check requirement 8.1.1 asks for, and it is
  // the reason it asks for a comparison: asserting that
  // `getOwnPropertyNames(new Uint8Array(4))` is empty would test a guess about
  // `%TypedArray%` rather than testing that the proposal left it alone.
  for (const source of [
    'const u = new Uint8Array(4); String(u.length);',
    'const u = new Uint8Array(4); String(u.length - 1);',
    'const u = new Uint8Array([1, 2, 3]); let s = 0; for (let i = 0; i < u.length; i++) { s += u[i]; } String(s);',
    'const u = new Uint8Array(4); Object.getOwnPropertyNames(u).join(",");',
    'const u = new Uint8Array(1); u[0] = 300; String(u[0]);',
    'const u = new Uint8ClampedArray(1); u[0] = 300; String(u[0]);',
    'const u = new Float64Array([1.5]); String(u[0]);',
    'const u = new Uint8Array([1, 2]); String(u.map((x) => x)[1]);',
    'const u = new Uint8Array([1, 2]); String(u.subarray(1).length);',
    'const u = new Uint8Array(4); String(u.buffer.byteLength);',
    'const u = new Uint8Array(4); String(typeof u.set);',
    'const u = new Uint8Array(2); let n = 2; String(u.length === n);',
  ]) {
    agrees(source);
  }
});

test('other length-bearing values are untouched', () => {
  for (const source of [
    'const s = "abc"; String(s.length - 1);',
    'function f() { return arguments.length; } String(f(1, 2));',
    'String(Array.from({ length: 3 }).length);',
    'String(Object.keys({ a: 1, b: 2 }).length);',
  ]) {
    agrees(source);
  }
});

test('the deprecation notice is reported once per agent and is not observable', () => {
  // Once per agent, not per use: a diagnostic that repeats inside a loop over
  // binary data is noise, and noise is ignored.
  const fired: string[] = [];
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    onDeprecation: (feature, replacement) => {
      fired.push(`${feature}|${replacement}`);
    },
  }));
  const realm = new ManagedRealm();
  realm.evaluateScriptSkipDebugger('new Uint8Array(4); new Uint8Array(8); new Float32Array(2); 1;');
  expect(fired.length).toBe(1);
  expect(fired[0]).toContain('%TypedArray%');
  // it names the REPLACEMENT: a notice that says only "deprecated" leaves the
  // reader to search
  expect(fired[0]).toContain('Span.<T>(buffer)');

  // a second agent is told too, since the notice is per agent
  const second: string[] = [];
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    onDeprecation: (feature) => {
      second.push(feature);
    },
  }));
  const other = new ManagedRealm();
  other.evaluateScriptSkipDebugger('new Uint8Array(1); 1;');
  expect(second.length).toBe(1);
});

test('the notice is absent where the proposal is not active, and optional always', () => {
  // With the feature off there is no successor to point at, and telling an
  // author to move to a type their engine does not have is worse than silence.
  const off: string[] = [];
  setSurroundingAgent(new Agent({
    features: [],
    onDeprecation: (f) => {
      off.push(f);
    },
  }));
  const realm = new ManagedRealm();
  realm.evaluateScriptSkipDebugger('new Uint8Array(1); 1;');
  expect(off.length).toBe(0);

  // and an implementation that installs no hook is conforming
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const bare = new ManagedRealm();
  const completion = bare.evaluateScriptSkipDebugger('const u = new Uint8Array(4); String(u.length);');
  expect(completion.Type).toBe('normal');
});
