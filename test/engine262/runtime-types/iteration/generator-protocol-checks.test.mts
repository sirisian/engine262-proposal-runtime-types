import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok, settledAfterJobs } from '../harness.mts';

test.each(['Generator', 'AsyncGenerator'])('%s checks the next argument and protocol result', (kind) => {
  expectStaticTypeError(`function unused(g: ${kind}.<uint8, uint8, uint8>) { g.next("s"); }`);
  expectStaticTypeError(`function unused(g: ${kind}.<uint8, uint8, uint8>) { g.return("s"); }`);
  expect(ok(`function unused(g: ${kind}.<uint8, uint8, uint8>) { g.next(); g.next(2); g.return(2); }`)).toBe(true);
});

test('the nominal generator result carries its value type', () => {
  expectStaticTypeError('function unused(g: Generator.<uint8, uint8, uint8>) { let s: string = g.next(1).value; }');
  expect(ok('function unused(g: Generator.<uint8, uint8, uint8>) { let n: uint8 = g.next(1).value; }')).toBe(true);
});

test('a bad dynamic next argument fails before entering the suspended body', () => {
  expect(evaluated(`
    let result = "waiting";
    function* gen(): Generator.<uint8, void, uint8> {
      try { const n = yield 1; result = String(n); }
      catch (e) { result = "caught in generator"; }
    }
    const g: any = gen();
    g.next();
    let failure = "";
    try { g.next("s"); } catch (e) { failure = e.constructor.name; }
    const before = result;
    g.next(2);
    failure + ":" + before + ":" + result;
  `)).toBe('TypeError:waiting:2');
});

test('next resolves generic protocol types in the generator creation context', () => {
  expect(evaluated(`
    function* gen<T: type>(): Generator.<uint8, void, T> { const n = yield 1; globalThis.sent = String(n); }
    const g: any = gen.<uint8>();
    g.next();
    let failure = "";
    try { g.next("s"); } catch (e) { failure = e.constructor.name; }
    g.next(2);
    failure + ":" + globalThis.sent;
  `)).toBe('TypeError:2');
});

test('async next rejects a bad dynamic argument and remains resumable', () => {
  expect(settledAfterJobs(`
    async function* gen(): AsyncGenerator.<uint8, void, uint8> { const n = yield 1; globalThis.sent = String(n); }
    async function run() {
      const g: any = gen();
      await g.next();
      let failure = "";
      try { await g.next("s"); } catch (e) { failure = e.constructor.name; }
      await g.next(2);
      globalThis.settled = failure + ":" + globalThis.sent;
    }
    run();
  `)).toBe('TypeError:2');
});
