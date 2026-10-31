import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, TypeDiagnosticOf } from '#self';

/**
 * Round 5 follow-up, Q20 (A+): an alias an earlier script published is judged
 * statically in a later script, for every form, generic included, and a type
 * alias binding is immutable, so that its value can never disagree with what
 * its name means as a type.
 */

function sequence(...sources: string[]) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return sources.map((source) => realm.evaluateScriptSkipDebugger(source));
}

const staticRefusal = (completion: unknown) => {
  const c = completion as { Type: string, Value: unknown };
  expect(c.Type).toBe('throw');
  expect(TypeDiagnosticOf(c.Value as never)).toMatchObject({ rule: 'rt-assignability', phase: 'static' });
};

test('an earlier script\'s alias is judged statically, generic ones included', () => {
  staticRefusal(sequence('type Known = string;', 'let k: Known = 1;')[1]);
  staticRefusal(sequence('type Box<T: type> = [].<T>;', 'function g(b: Box.<uint8>): Box.<uint8> { return ["x"]; }')[1]);
  staticRefusal(sequence('type Box<T: type> = [].<T>;', 'let b: Box.<uint8> = ["x"];')[1]);
  const ok = sequence('type Box<T: type> = [].<T>;', 'function g(b: Box.<uint8>): Box.<uint8> { return b; } String(g([1])[0]);')[1] as { Value: { stringValue(): string } };
  expect(ok.Value.stringValue()).toBe('1');
  const shadowed = sequence('type Box<T: type> = [].<T>;', '{ type Box<T: type> = T; let b: Box.<uint8> = 3; String(b); }')[1] as { Value: { stringValue(): string } };
  expect(shadowed.Value.stringValue()).toBe('3');
});

test('a type alias binding cannot be reassigned', () => {
  for (const completion of [
    sequence('type T = string; T = uint8;')[0],
    sequence("type T = string; eval('T = uint8');")[0],
    sequence('type Known = string;', 'Known = uint8;')[1],
  ]) {
    expect(completion).toMatchObject({ Type: 'throw' });
  }
  const loop = sequence("let out = ''; for (let i = 0; i < 2; i++) { type T = string; let t: T = 'x' + i; out += t; } out;")[0] as { Value: { stringValue(): string } };
  expect(loop.Value.stringValue()).toBe('x0x1');
});
