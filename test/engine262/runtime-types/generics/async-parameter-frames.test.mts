import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * A type parameter is readable across an `await`.
 *
 * A generic class's parameters are bound in a frame that is pushed for the
 * duration of a call, and an async body outlives its call: it suspends at each
 * `await` and resumes on a job, by which time the frame is off the stack.
 * GeneratorStart already captured the frame for a `yield`; the two async start
 * paths did not, so a body read its parameters only up to its first `await`.
 *
 * The failure was invisible from outside because an async body REJECTS rather
 * than throwing - a caller that only inspected the returned promise saw a
 * promise either way. These tests observe the rejection, which is what makes
 * them able to fail.
 */
function settle(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source);
  if (completion.Type === 'throw') {
    return 'threw synchronously';
  }
  const read = realm.evaluateScriptSkipDebugger('String(globalThis.out)');
  return (read as { Value?: { stringValue?(): string } }).Value?.stringValue?.() ?? 'unread';
}

/** Runs `call`, recording its settled value or its rejection message. */
function observed(body: string, call: string): string {
  return settle(`globalThis.out = 'never settled'; ${body} ${call}.then(`
    + "(v) => { globalThis.out = 'ok:' + String(v); },"
    + "(e) => { globalThis.out = 'ERR:' + String(e && e.message); });");
}

test('an async method reads its class type parameter across an await', () => {
  const C = 'class C<W: uint32> { async m() { await 0; return W; } }';
  expect(observed(C, 'new C.<4>().m()')).toBe('ok:4');
  // and across more than one suspension
  expect(observed('class C<W: uint32> { async m() { await 0; await 0; return W * (2 := uint32); } }',
    'new C.<4>().m()')).toBe('ok:8');
  // awaiting a real promise, not just a resolved value
  expect(observed('class C<W: uint32> { async m() { const x = await Promise.resolve((1 := uint32)); return W + x; } }',
    'new C.<4>().m()')).toBe('ok:5');
  // the frame survives a loop that suspends on each turn
  expect(observed('class C<W: uint32> { async m() { let t = (0 := uint32);'
    + ' for (let i = 0; i < 3; i++) { await 0; t += W; } return t; } }',
  'new C.<4>().m()')).toBe('ok:12');
  // and a suspension in a finally block, which resumes on a different path
  expect(observed('class C<W: uint32> { async m() { try { await 0; return W; } finally { await 0; } } }',
    'new C.<4>().m()')).toBe('ok:4');
});

test('every async form carries the frame', () => {
  // an async function applied with explicit type arguments
  expect(observed('async function f<W: uint32>() { await 0; return W; }', 'f.<7>()')).toBe('ok:7');
  // a method's own type parameter, rather than its class's
  expect(observed('class C { async m<W: uint32>() { await 0; return W; } }', 'new C().m.<9>()')).toBe('ok:9');
  // an async arrow closing over the enclosing specialization
  expect(observed('class C<W: uint32> { m() { return (async () => { await 0; return W; })(); } }',
    'new C.<4>().m()')).toBe('ok:4');
  // one async body awaiting another
  expect(observed('class C<W: uint32> { async inner() { await 0; return W; }'
    + ' async m() { await 0; return await this.inner(); } }', 'new C.<4>().m()')).toBe('ok:4');
  // a parameter used as a TYPE rather than as a value
  expect(observed('class C<T> { async m() { await 0; return (1 := T) is uint8; } }',
    'new C.<uint8>().m()')).toBe('ok:true');
});

test('an async generator suspends at both await and yield', () => {
  // a third start path, which the other two captures do not reach
  expect(settle("globalThis.out = 'never settled';"
    + ' class C<W: uint32> { async *m() { await 0; yield W; } }'
    + ' (async () => { for await (const v of new C.<4>().m()) { globalThis.out = "ok:" + String(v); } })()'
    + '.catch((e) => { globalThis.out = "ERR:" + String(e && e.message); });')).toBe('ok:4');
  // and keeps it across successive yields
  expect(settle("globalThis.out = 'never settled';"
    + ' class C<W: uint32> { async *m() { await 0; yield W; await 0; yield W * (2 := uint32); } }'
    + ' (async () => { let s = ""; for await (const v of new C.<4>().m()) { s += String(v) + ","; }'
    + ' globalThis.out = "ok:" + s; })().catch((e) => { globalThis.out = "ERR:" + String(e && e.message); });')).toBe('ok:4,8,');
});

test('the surrounding behaviour is unchanged', () => {
  // an async body with no type parameter to read
  expect(observed('async function f() { await 0; return 5; }', 'f()')).toBe('ok:5');
  expect(observed('class C<W: uint32> { async m() { await 0; return 99; } }', 'new C.<4>().m()')).toBe('ok:99');
  // a synchronous generator, which was already carrying its frame
  expect(settle("globalThis.out = 'never settled';"
    + ' class C<W: uint32> { *m() { yield W; } }'
    + ' globalThis.out = "ok:" + String([...new C.<4>().m()][0]);')).toBe('ok:4');
});
