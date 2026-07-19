import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

test('is evaluates to the membership test', () => {
  expect(evaluated('((5 := uint8) is uint8) === true && (5 is uint8) === false ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type T = uint8 | string; ("s" is T) === true ? "ok" : "no";')).toBe('ok');
});

test(':= applies the conversion rule', () => {
  expect(evaluated('("5" := number) === 5 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('(5 := string) === "5" ? "ok" : "no";')).toBe('ok');
  expect(evaluated('(0 := boolean) === false ? "ok" : "no";')).toBe('ok');
  expect(evaluated('("7" := uint8) === (7 := uint8) ? "ok" : "no";')).toBe('ok');
  expectThrown('("300" := uint8);');
  expectThrown('({} := uint8);');
});

test('the type operator produces the interned Type Object', () => {
  expect(evaluated('type T = uint8; (type uint8) === T ? "same" : "different";')).toBe('same');
  expect(evaluated('const u = type uint8 | string; type V = string | uint8; u === V ? "same" : "different";')).toBe('same');
});

test('typed catch clauses dispatch on the thrown value', () => {
  expect(evaluated('try { throw "s"; } catch (e: uint8) { "wrong"; } catch (e: string) { e; }')).toBe('s');
  expect(evaluated('try { throw (3 := uint8); } catch (e: uint8) { "int"; } catch (e: string) { "str"; }')).toBe('int');
  expect(evaluated('try { throw 3; } catch (e: uint8) { "int"; } catch (e) { "plain"; }')).toBe('plain');
  expect(evaluated('try { throw true; } catch (e: uint8) { "int"; } catch (e) { "all"; }')).toBe('all');
  expectThrown('try { throw true; } catch (e: uint8) { "int"; }');
});

test('annotated bindings enforce at run time across the any boundary', () => {
  // The static type of a call is any, so the check happens at the binding.
  expectThrown('function f() { return "s"; } let x: uint8 = f();');
  expect(evaluated('function f() { return 5; } let x: uint8 = f(); x === (5 := uint8) ? "ok" : "no";')).toBe('ok');
  expectThrown('function f() { return 300; } var v: uint8 = f();');
});
