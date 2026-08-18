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
  // The completion is read the way `harness.mts` reads one: as `unknown` and
  // cast, since `ValueCompletion` does not expose Type/Value on its type.
  const completion = realm.evaluateScriptSkipDebugger(source) as unknown as {
    Type: string, Value: { stringValue?(): string, constructor: { name: string } },
  };
  if (completion.Type !== 'normal') {
    return `THREW ${completion.Value.constructor.name}`;
  }
  const value = completion.Value;
  return value.stringValue ? value.stringValue() : String(value);
}

/** The same source with the feature on and off must agree. */
function agrees(source: string): void {
  const on = evaluate(source, ['runtime-types']);
  const off = evaluate(source, []);
  expect(on, `flag-on and flag-off disagree for: ${source}`).toBe(off);
}

// Each idiom is its OWN test case rather than a loop over a list. A loop
// reports the first disagreement and hides the rest, and these are exactly the
// assertions where knowing WHICH idiom broke is the whole diagnostic.

test('a plain array is unchanged: length', () => {
  agrees('const a = [1, 2, 3]; String(a.length);');
});

test('a plain array is unchanged: length in arithmetic', () => {
  agrees('const a = [1, 2, 3]; String(a.length - 1);');
});

test('a plain array is unchanged: empty length minus one', () => {
  agrees('const a = []; String(a.length - 1);');
});

test('a plain array is unchanged: counted for loop', () => {
  agrees('const a = [1, 2, 3]; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; } String(s);');
});

test('a plain array is unchanged: reverse loop', () => {
  agrees('const a = [1, 2, 3]; let o = ""; for (let i = a.length - 1; i >= 0; i--) { o += a[i]; } o;');
});

test('a plain array is unchanged: forEach', () => {
  agrees('const a = [1, 2, 3]; let n = 0; a.forEach(() => { n += 1; }); String(n);');
});

test('a plain array is unchanged: map and filter', () => {
  agrees('const a = [1, 2, 3]; String(a.map((x) => x * 2).filter((x) => x > 2).length);');
});

test('a plain array is unchanged: push and pop', () => {
  agrees('const a = [1]; a.push(2); a.pop(); String(a.length);');
});

test('a plain array is unchanged: length assignment', () => {
  agrees('const a = [1, 2, 3]; a.length = 1; String(a.length);');
});

test('a plain array is unchanged: slice and join', () => {
  agrees('const a = [1, 2, 3]; a.slice(1).join(\',\');');
});

test('a plain array is unchanged: out-of-range read', () => {
  agrees('const a = [1, 2, 3]; String(a[99]);');
});

test('a plain array is unchanged: equality against a binding', () => {
  agrees('const a = [1, 2, 3]; let n = 3; String(a.length === n);');
});

test('a TypedArray is unchanged: length', () => {
  agrees('const u = new Uint8Array(4); String(u.length);');
});

test('a TypedArray is unchanged: length in arithmetic', () => {
  agrees('const u = new Uint8Array(4); String(u.length - 1);');
});

test('a TypedArray is unchanged: counted for loop', () => {
  agrees('const u = new Uint8Array([1, 2, 3]); let s = 0; for (let i = 0; i < u.length; i++) { s += u[i]; } String(s);');
});

test('a TypedArray is unchanged: own property names', () => {
  agrees('const u = new Uint8Array(4); Object.getOwnPropertyNames(u).join(\',\');');
});

test('a TypedArray is unchanged: a store wraps', () => {
  agrees('const u = new Uint8Array(1); u[0] = 300; String(u[0]);');
});

test('a TypedArray is unchanged: a clamped store clamps', () => {
  agrees('const u = new Uint8ClampedArray(1); u[0] = 300; String(u[0]);');
});

test('a TypedArray is unchanged: a float element', () => {
  agrees('const u = new Float64Array([1.5]); String(u[0]);');
});

test('a TypedArray is unchanged: map', () => {
  agrees('const u = new Uint8Array([1, 2]); String(u.map((x) => x)[1]);');
});

test('a TypedArray is unchanged: subarray', () => {
  agrees('const u = new Uint8Array([1, 2]); String(u.subarray(1).length);');
});

test('a TypedArray is unchanged: buffer byte length', () => {
  agrees('const u = new Uint8Array(4); String(u.buffer.byteLength);');
});

test('a TypedArray is unchanged: set is present', () => {
  agrees('const u = new Uint8Array(4); String(typeof u.set);');
});

test('a TypedArray is unchanged: equality against a binding', () => {
  agrees('const u = new Uint8Array(2); let n = 2; String(u.length === n);');
});

test('other length-bearing values are unchanged: String length', () => {
  agrees('const s = "abc"; String(s.length - 1);');
});

test('other length-bearing values are unchanged: arguments length', () => {
  agrees('function f() { return arguments.length; } String(f(1, 2));');
});

test('other length-bearing values are unchanged: Array.from', () => {
  agrees('String(Array.from({ length: 3 }).length);');
});

test('other length-bearing values are unchanged: Object.keys', () => {
  agrees('String(Object.keys({ a: 1, b: 2 }).length);');
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
  expect((completion as unknown as { Type: string }).Type).toBe('normal');
});
