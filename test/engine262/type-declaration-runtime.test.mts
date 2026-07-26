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

test('enums bind objects with sequential member values', () => {
  expect(evaluated('enum Color { Red, Green, Blue } Color.Red === 0 && Color.Green === 1 && Color.Blue === 2 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum E { A, B = 10, C } E.C === 11 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum S { A = "a", B } typeof S.A === "string" && S.B === 1 ? "ok" : "no";')).toBe('ok');
});

test('enum membership is SameValue against the members', () => {
  expect(evaluated('enum E { A, B = 10 } (0 is E) && (10 is E) && !(3 is E) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum E { A } try { let x: E = 5; "no"; } catch (err) { "caught"; }')).toBe('caught');
  expect(evaluated('enum E { A, B } let x: E = 1; x === 1 ? "ok" : "no";')).toBe('ok');
});

test('interfaces check structurally', () => {
  expect(evaluated(`interface Point { x: number; y: number }
    ({ x: 1, y: 2 } is Point) && !({ x: 1 } is Point) && !({ x: "a", y: 2 } is Point) ? "ok" : "no";`)).toBe('ok');
  expect(evaluated(`interface Named { name: string; greet(a) }
    ({ name: "n", greet() {} } is Named) && !({ name: "n", greet: 3 } is Named) ? "ok" : "no";`)).toBe('ok');
  // MIGRATED TO STATIC FORM. This asserted a RUNTIME throw, caught by the
  // try - which is what a mistyped object literal produced while the checker
  // could not see into a literal's contents. It is an Early Error now, so the
  // try cannot swallow it, and the runtime backstop is asserted beside it
  // through the `any` path where the checker still cannot decide (F37).
  expect(run('interface I { x: string } let p: I = { x: 300 };')).toMatchObject({ Type: 'throw' });
  // An interface member converts as an object type's does (F87): 300 has a
  // canonical text and reaches `string` losslessly, so it converts rather than
  // failing - the same rule `let s: string = 300` has always followed.
  expect(evaluated('interface I { x: string } function anyv() { return { x: 300 }; } let p: I = anyv(); p.x + "/" + typeof p.x;')).toBe('300/string');
  // A member the type cannot hold is still refused.
  expect(evaluated('interface J { x: uint8 } function anyv() { return { x: 300 }; } try { let p: J = anyv(); "no"; } catch (e) { "caught"; }')).toBe('caught');
});

test('class operators dispatch on binary expressions', () => {
  // proposal-runtime-types (spec sec-class-operators): the receiver is the left
  // operand and the declaration's parameter is the right operand.
  expect(evaluated(`class Vec {
    constructor(x) { this.x = x; }
    operator +(rhs) { return new Vec(this.x + rhs.x); }
    operator *(rhs) { return new Vec(this.x * rhs.x); }
  }
  const v = new Vec(2) + new Vec(3);
  const w = new Vec(2) * new Vec(3);
  v.x === 5 && w.x === 6 ? "ok" : "no";`)).toBe('ok');
  // Objects without operators keep today's behaviour.
  expect(evaluated('const r = {} + 1; typeof r === "string" ? "ok" : "no";')).toBe('ok');
});
