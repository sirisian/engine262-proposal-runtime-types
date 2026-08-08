import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-engine-decorator-replacement stage D: the two standing defects.
 */

const label = (program: string): string => evaluated(`let l; function g(c) { l = c.label; } ${program} String(l);`);

test('a block reflection reports its LABEL', () => {
  // It answered *undefined* in every form since the contexts were built, because
  // nothing read it — the state a property should never be in, since it claims
  // to report something it never reports.
  expect(label('lbl: @g { 1; }')).toBe('lbl');
  expect(label('@g { 1; }')).toBe('undefined');
});

test('the label may name the OWNING statement', () => {
  // `outer: while (c) { … }` labels the loop and the decorated block is its
  // body. decorators.md gives `WhileBlock` and its siblings a `label`, and the
  // label those forms have is the owning statement's — so it propagates one
  // level in, and no further: anything deeper is a different block.
  expect(label('let n = 0; outer: while (n < 1) @g { n += 1; }')).toBe('outer');
  expect(label('outer: for (let i = 0; i < 1; i++) @g { 1; }')).toBe('outer');
  expect(label('outer: for (const x of [1]) @g { 1; }')).toBe('outer');
  expect(label('outer: if (true) @g { 1; }')).toBe('outer');
});

test('nested labels report the NEAREST', () => {
  // The design's field is singular, so one is chosen: the label immediately
  // attached to the block.
  expect(label('a: b: @g { 1; }')).toBe('b');
});

test('the label does not disturb the kind', () => {
  expect(evaluated('let k; function g(c) { k = c.kind; } lbl: @g { 1; } k;')).toBe('Block');
  expect(evaluated('let k; let n = 0; function g(c) { k = c.kind; } outer: while (n < 1) @g { n += 1; } k;')).toBe('WhileBlock');
});

test('all TWELVE block contexts now exist', () => {
  // `Reflect.MatchArmBlock` was the one member of the family with no context
  // object while the other eleven had one.
  expect(evaluated('String(["Block","IfBlock","ElseIfBlock","ElseBlock","WhileBlock","DoWhileBlock",'
    + '"ForBlock","ForInBlock","ForOfBlock","DoBlock","DoGeneratorBlock","MatchArmBlock"]'
    + '.filter((n) => typeof Reflect[n] === "object").length);')).toBe('12');
});

test('PINNED: a match ARM cannot be decorated yet — grammar, not reflection', () => {
  // The plan called this "a missing reflection rather than a missing feature",
  // on the reasoning that `match` is implemented. **Measuring shows that was
  // half right**: the reflection is now registered, and no arm can carry a
  // decorator, so nothing ever builds the context.
  //
  // The same mistake as the block forms earlier in this project — assuming a
  // decoration position exists because the thing it would decorate does.
  expect(evaluated('const r = match (1) { when 1: "one"; when _: "other"; }; r;')).toBe('one');
  expect(evaluated('try { eval(\'const r = match (1) { when 1: (do { "one" }); when _: "o"; };\'); "ACCEPTED"; }'
    + ' catch (e) { e.constructor.name; }')).toBe('ACCEPTED');
  expect(evaluated('try { eval(\'function g(c){} const r = match (1) { when 1: @g (do { 1 }); when _: 0; };\'); "ACCEPTED"; }'
    + ' catch (e) { e.constructor.name; }')).toBe('SyntaxError');
});
