import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

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

function evaluated(source: string) {
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
  expect(evaluated(`
    try { throw (1 := uint8); }
    catch (e: uint8) { var a = 1; }
    catch (e) { var b = 2; }
    a === 1 && b === undefined ? 'hoisted' : 'no';
  `).stringValue()).toBe('hoisted');
});

test('a matching typed clause catches', () => {
  expect(evaluated('try { throw "boom"; } catch (e: string) { e; }').stringValue()).toBe('boom');
});

test('feature off: annotations and extra clauses stay errors', () => {
  expectParseError('try {} catch (e: T) {}', false);
  expectParseError('try {} catch (e) {} catch (q) {}', false);
  expect(statements('try {} catch (e) {}', false)[0]).toMatchObject({ type: 'TryStatement' });
});
