import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';
import {
  evaluated, bool, evaluatedSequence, ok, expectError,
} from '../harness.mts';

/**
 * Spec: #sec-typed-catch (Typed Catch).
 *
 * A `catch (e: T)` clause runs only when the thrown value satisfies T. This
 * file covers the grammar of the annotated clause and the multi-clause form,
 * then the semantics: clause order, the untyped catch-all, narrowing of the
 * binding inside a matched clause, and propagation when nothing matches.
 */

function makeRealm(runtimeTypes = true) {
  setSurroundingAgent(new Agent(runtimeTypes ? { features: ['runtime-types'] } : {}));
  return new ManagedRealm();
}

function parseScript(source: string, runtimeTypes = true) {
  makeRealm(runtimeTypes);
  const p = new Parser({ source, specifier: 'catch-test' });
  const script = p.parseScript();
  if (p.earlyErrors.size > 0) {
    throw p.earlyErrors.values().next().value;
  }
  return script;
}

function statements(source: string, runtimeTypes = true) {
  const body = parseScript(source, runtimeTypes).ScriptBody;
  expect(body).toBeTruthy();
  return body ? body.StatementList : [];
}

function expectParseError(source: string, runtimeTypes = true) {
  expect(() => parseScript(source, runtimeTypes)).toThrow();
}

function evaluatedValue(source: string) {
  const realm = makeRealm();
  const completion = realm.evaluateScriptSkipDebugger(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value;
}

test('a single catch clause takes a type annotation', () => {
  const stmt = statements('try { f(); } catch (e: RangeError) {}')[0] as {
    Catch?: { TypeAnnotation?: unknown } | null,
    CatchClauses?: readonly unknown[] | null,
  };
  expect(stmt).toMatchObject({
    type: 'TryStatement',
    Catch: {
      type: 'Catch',
      CatchParameter: { type: 'BindingIdentifier', name: 'e' },
      TypeAnnotation: { type: 'TypeAnnotation', Type: { type: 'TypeReference' } },
    },
  });
  expect(stmt.CatchClauses).toHaveLength(1);
  expect(stmt.CatchClauses?.[0]).toBe(stmt.Catch);
});

test('multiple catch clauses', () => {
  const stmt = statements(`try {}
    catch (e: RangeError) {}
    catch ({ msg }: TypeError) {}
    catch (e) {}
    finally {}`)[0] as { Catch?: unknown, CatchClauses?: readonly { type: string }[] | null, Finally?: unknown };
  expect(stmt.CatchClauses).toHaveLength(3);
  expect(stmt.CatchClauses?.[0]).toBe(stmt.Catch);
  expect(stmt.CatchClauses?.[1]).toMatchObject({
    CatchParameter: { type: 'ObjectBindingPattern' },
    TypeAnnotation: { type: 'TypeAnnotation' },
  });
  expect(stmt.CatchClauses?.[2]).toMatchObject({ CatchParameter: { name: 'e' }, TypeAnnotation: null });
  expect(stmt.Finally).toBeTruthy();
  // Bare clauses may repeat as well.
  const bare = statements('try {} catch {} catch {}')[0] as { CatchClauses?: readonly unknown[] | null };
  expect(bare.CatchClauses).toHaveLength(2);
});

test('each clause has its own lexical scope', () => {
  expect(statements('try {} catch (e) { let x; } catch (e) { let x; }')).toHaveLength(1);
  expectParseError('try {} catch (e) { let e; }');
});

test('var declarations in every clause are hoisted', () => {
  expect(evaluatedValue(`
    try { throw (1 := uint8); }
    catch (e: uint8) { var a = 1; }
    catch (e) { var b = 2; }
    a === 1 && b === undefined ? 'hoisted' : 'no';
  `).stringValue()).toBe('hoisted');
});

test('a matching typed clause catches', () => {
  expect(evaluatedValue('try { throw "boom"; } catch (e: string) { e; }').stringValue()).toBe('boom');
});

test('feature off: annotations and extra clauses stay errors', () => {
  expectParseError('try {} catch (e: T) {}', false);
  expectParseError('try {} catch (e) {} catch (q) {}', false);
  expect(statements('try {} catch (e) {}', false)[0]).toMatchObject({ type: 'TryStatement' });
});

// -- Semantics of a typed clause ----------------------------------------------

/*
 * Design: errorhandling.md.
 *
 * A `catch (e: T)` runs only when the thrown value satisfies T, clauses are
 * tried in order, an untyped clause catches the rest, the binding is narrowed
 * within a typed clause, and an unmatched value propagates. The built-in error
 * constructors are registered as type names, so typed catch reaches them
 * (TypeError, RangeError, and the rest) as well as user classes and primitive
 * types.
 */

// -- Typed catch by built-in error type ----------------------------------------
test('typed catch: a clause runs when the thrown value satisfies its type', () => {
  expect(evaluated('let r = "none"; try { throw new TypeError("x"); } catch (e: TypeError) { r = "caught"; } r;')).toBe('caught');
});

test('typed catch: clauses are tried in order and the first match runs', () => {
  expect(evaluated('let r = "none"; try { throw new RangeError("x"); } catch (e: TypeError) { r = "t"; } catch (e: RangeError) { r = "range"; } r;')).toBe('range');
});

test('typed catch: an untyped clause at the end catches the rest', () => {
  expect(evaluated('let r = "none"; try { throw new EvalError("x"); } catch (e: TypeError) { r = "t"; } catch (e) { r = "fallback"; } r;')).toBe('fallback');
});

test('typed catch: an unmatched value propagates to the enclosing handler', () => {
  expect(evaluated('let r = "none"; try { try { throw new RangeError("x"); } catch (e: TypeError) { r = "wrong"; } } catch (e) { r = "outer"; } r;')).toBe('outer');
});

// -- Narrowing within a typed clause -------------------------------------------
test('typed catch: the binding is narrowed to the clause type', () => {
  // e.message is available without a cast
  expect(evaluated('let r = "none"; try { throw new TypeError("msg"); } catch (e: TypeError) { r = e.message; } r;')).toBe('msg');
});

// -- Typed catch by user class and by the Error base ---------------------------
test('typed catch: works with a user class type', () => {
  expect(evaluated('class MyErr {} let r = "none"; try { throw new MyErr(); } catch (e: MyErr) { r = "caught"; } r;')).toBe('caught');
});

test('typed catch: a base Error clause catches a subclass error', () => {
  // TypeError is an Error, so a catch (e: Error) catches it (membership by chain)
  expect(evaluated('let r = "none"; try { throw new TypeError("x"); } catch (e: Error) { r = "base"; } r;')).toBe('base');
  expect(bool('let e = new RangeError("x"); String(e instanceof Error);')).toBe(true);
});

// -- The errors a typed program raises are the standard ones -------------------
test('typed catch: a failed parse throws a catchable RangeError', () => {
  // uint8.parse('256') is a RangeError, catchable by type
  expect(evaluated('let r = "none"; try { uint8.parse("256"); } catch (e: RangeError) { r = "range"; } r;')).toBe('range');
});

// -- Typed catch across an await boundary --------------------------------------
test('typed catch: a clause matches an awaited rejection inside an async function', () => {
  // errorhandling.md: a typed catch behaves the same around an awaited call, so a
  // rejection surfaced by await is matched by the clause whose type it satisfies.
  // The async continuation runs as a job, so a reader script evaluated after it
  // (on the same realm, once the queue has drained) observes the outcome.
  const setup = `
    globalThis.out = "none";
    async function f() {
      try { await Promise.reject(new TypeError("boom")); }
      catch (e: TypeError) { globalThis.out = "caught-type-error"; }
      catch (e) { globalThis.out = "caught-other"; }
    }
    f();
  `;
  expect(evaluatedSequence([setup, 'globalThis.out;'])).toBe('caught-type-error');
  // a more specific later clause is not reached when an earlier one matches, and
  // a resolved value is not caught at all
  const resolvePath = `
    globalThis.out2 = "none";
    async function g() {
      try { let v = await Promise.resolve(7); globalThis.out2 = "resolved-" + v; }
      catch (e) { globalThis.out2 = "caught"; }
    }
    g();
  `;
  expect(evaluatedSequence([resolvePath, 'globalThis.out2;'])).toBe('resolved-7');
});

test('typed catch: an untyped clause must be last', () => {
  // #sec-typed-catch states this as a type error and errorhandling.md as a
  // rule - "a typed clause after it could never run" - and neither the engine
  // enforced it nor any test asserted it. An untyped clause catches
  // everything, so a typed clause behind it is dead code that reads as live.
  expectError('try { throw 1; } catch (e) { 1; } catch (e: TypeError) { 2; }');
  expectError('try { throw 1; } catch (e) { 1; } catch (e: TypeError) { 2; } catch (e: RangeError) { 3; }');

  // The shapes it must not refuse: an untyped tail, all-typed clauses, and a
  // lone untyped clause, which is ordinary JavaScript.
  expect(ok('try { throw 1; } catch (e: TypeError) { 2; } catch (e) { 1; }')).toBe(true);
  // Thrown as a TypeError so a clause catches it: an all-typed `try` whose
  // value matches nothing throws at run time, which `ok` cannot tell from a
  // type error.
  expect(ok('try { throw new TypeError("x"); } catch (e: TypeError) { 2; } catch (e: RangeError) { 3; }')).toBe(true);
  expect(ok('try { throw 1; } catch (e) { 1; }')).toBe(true);
});
