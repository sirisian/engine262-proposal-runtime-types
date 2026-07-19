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

test('generic aliases instantiate by substitution and intern', () => {
  expect(evaluated(`type Pair<A, B> = [A, B];
    type P1 = Pair.<uint8, string>;
    type P2 = Pair.<uint8, string>;
    P1 === P2 ? "same" : "different";`)).toBe('same');
  // Substitution is transparent: the instantiation is the substituted type.
  expect(evaluated('type Pair<A, B> = [A, B]; type P = Pair.<uint8, string>; type T2 = [uint8, string]; P === T2 ? "same" : "different";')).toBe('same');
  expect(evaluated('type Pair<A, B> = [A, B]; type P = Pair.<uint8, string>; [(1 := uint8), "a"] instanceof P ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type Pair<A, B> = [A, B]; Pair.<uint8, string> !== Pair.<string, uint8> ? "ok" : "no";')).toBe('ok');
});

test('generic structural bodies substitute', () => {
  expect(evaluated(`type Box<T> = { v: T };
    type B = Box.<number>;
    ({ v: 1 } is B) && !({ v: "s" } is B) ? "ok" : "no";`)).toBe('ok');
  expect(evaluated('type Box<T> = { v: T }; type N = Box.<Box.<number>>; ({ v: { v: 1 } } is N) ? "ok" : "no";')).toBe('ok');
});

test('expression-position type arguments specialize', () => {
  expect(evaluated('type Pair<A, B> = [A, B]; const P = Pair.<uint8, string>; type Q = Pair.<uint8, string>; P === Q ? "same" : "different";')).toBe('same');
});

test('arity mismatches throw', () => {
  expect(run('type Pair<A, B> = [A, B]; type P = Pair.<uint8>;')).toMatchObject({ Type: 'throw' });
});
