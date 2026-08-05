import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../readme/harness.mts';

/**
 * Extension coverage - threading.md, #sec-threading-parallel-iteration.
 *
 * WHAT IS SIMULATED. Every slice runs on the calling agent, in ascending slice
 * order. That is not a shortcut around the tests: #sec-thread.parallelfor makes
 * it normative that "executing every slice on the calling agent, in ascending
 * slice order, is a conforming implementation", exactly so that a host with no
 * threads still runs the program and gets the same answer. The observable
 * contract - the partition, the combining order, the error policy - is therefore
 * fully testable here, and none of it is weakened by the absence of parallelism.
 *
 * What is NOT testable here is that the work is spread over agents at all. That
 * needs the pool, and the pool is where a real implementation earns the operation.
 */

// -- parallelFor ----------------------------------------------------------------
test('parallelFor: the body is called once with each integer in the range', () => {
  expect(evaluated('var seen = []; Thread.parallelFor(0, 10, (i) => seen.push(i)); seen.sort((a, b) => a - b).join(",");'))
    .toBe('0,1,2,3,4,5,6,7,8,9');
});

test('parallelFor: an empty range calls the body not at all', () => {
  expect(evaluated('var n = 0; Thread.parallelFor(5, 5, () => { n += 1; }); String(n);')).toBe('0');
  expect(evaluated('var n = 0; Thread.parallelFor(5, 2, () => { n += 1; }); String(n);')).toBe('0');
});

test('parallelFor: it returns undefined once every slice has finished', () => {
  expect(evaluated('String(Thread.parallelFor(0, 4, () => {}));')).toBe('undefined');
});

// -- parallelReduce -------------------------------------------------------------
test('parallelReduce: folds per slice and combines the partials', () => {
  expect(evaluated('String(Thread.parallelReduce(0, 101, 0, (acc, i) => acc + i, (a, b) => a + b));')).toBe('5050');
});

test('parallelReduce: an empty range is the initial value', () => {
  expect(evaluated('String(Thread.parallelReduce(3, 3, 42, (a, i) => a + i, (a, b) => a + b));')).toBe('42');
});

test('D7 parallelReduce: the same range and callbacks give the same value', () => {
  // The determinism guarantee. A partition fixed by (begin, end) alone plus
  // combining in ascending slice order is the whole of it, and it holds although
  // floating-point addition - the case the operation exists for - is not
  // associative.
  expect(evaluated(`
    var f = (acc, i) => acc + 1 / (i + 1);
    var a = Thread.parallelReduce(0, 1000, 0, f, (x, y) => x + y);
    var b = Thread.parallelReduce(0, 1000, 0, f, (x, y) => x + y);
    String(a === b);
  `)).toBe('true');
});

test('D7 parallelReduce: the partition is visible, so a non-associative combine is not the sequential fold', () => {
  // Worth pinning: the answer really is per-slice partials combined, not a
  // left-to-right fold over every element with the parallel API's clothes on. A
  // combine that ignores its left operand exposes the difference.
  expect(evaluated(`
    var sliced = Thread.parallelReduce(0, 100, 0, (acc, i) => acc + i, (a, b) => b);
    var whole = Thread.parallelReduce(0, 100, 0, (acc, i) => acc + i, (a, b) => a + b);
    String(sliced !== whole);
  `)).toBe('true');
});

// -- D7: the error policy -------------------------------------------------------
test('D7 errors: the lowest-numbered failing slice is the one reported', () => {
  // "That is the completion a sequential execution would have produced, since a
  // sequential execution reaches the lowest failing index first and stops there."
  expect(evaluated(`
    var message = '';
    try { Thread.parallelFor(0, 100, (i) => { if (i === 90 || i === 20) { throw new Error('at ' + i); } }); }
    catch (e) { message = e.message; }
    message;
  `)).toBe('at 20');
});

test('D7 errors: slices below the failing one finish, those above are cancelled', () => {
  expect(evaluated(`
    var ran = 0;
    try { Thread.parallelFor(0, 100, (i) => { ran += 1; if (i === 50) { throw new Error('boom'); } }); }
    catch (e) {}
    String(ran > 50) + "/" + String(ran < 100);
  `)).toBe('true/true');
});

test('D7 errors: parallelReduce follows the same rule', () => {
  expect(evaluated(`
    var message = '';
    try { Thread.parallelReduce(0, 100, 0, (acc, i) => { if (i === 80 || i === 10) { throw new Error('at ' + i); } return acc + i; }, (a, b) => a + b); }
    catch (e) { message = e.message; }
    message;
  `)).toBe('at 10');
});

test('D7 errors: a throwing combine propagates', () => {
  expectThrownKind('Thread.parallelReduce(0, 100, 0, (a, i) => a + i, () => { throw new TypeError("combine"); });', 'TypeError');
});

// -- D4: it does not block ------------------------------------------------------
test('D4: parallelFor is callable where a blocking operation would not be', () => {
  // The calling agent participates rather than parking, so a call never blocks in
  // the sense the synchronization clause uses - which is why it is legal on a
  // host's main thread, where a frame loop lives.
  expect(evaluated(`
    var lock = new Lock();
    var refusedBlocking = false;
    lock.hold(() => { try { new Condition().wait(lock); } catch (e) { refusedBlocking = true; } });
    var total = 0;
    Thread.parallelFor(0, 10, (i) => { total += i; });
    String(refusedBlocking) + "/" + String(total);
  `)).toBe('true/45');
});

test('D4: a nested parallelFor runs rather than deadlocking', () => {
  // "a body that itself calls parallelFor cannot deadlock by exhausting the pool,
  // since the inner call participates on the same terms".
  expect(evaluated(`
    var total = 0;
    Thread.parallelFor(0, 4, () => { Thread.parallelFor(0, 3, () => { total += 1; }); });
    String(total);
  `)).toBe('12');
});
