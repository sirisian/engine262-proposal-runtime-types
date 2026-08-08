import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-reflection-shape-block (the Block reflection shape).
 *
 * A block decorator's context and the clauses it carries.
 */

const label = (program: string): string => evaluated(`let l; function g(c) { l = c.label; } ${program} String(l);`);

test('a block reflection reports its LABEL', () => {
  // It answered *undefined* in every form since the contexts were built, because
  // nothing read it - the state a property should never be in, since it claims
  // to report something it never reports.
  expect(label('lbl: @g { 1; }')).toBe('lbl');
  expect(label('@g { 1; }')).toBe('undefined');
});

test('the label may name the OWNING statement', () => {
  // `outer: while (c) { ... }` labels the loop and the decorated block is its
  // body. decorators.md gives `WhileBlock` and its siblings a `label`, and the
  // label those forms have is the owning statement's - so it propagates one
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

test('a match ARM cannot be decorated yet - grammar, not reflection', () => {
  // The plan called this "a missing reflection rather than a missing feature",
  // on the reasoning that `match` is implemented. **Measuring shows that was
  // half right**: the reflection is now registered, and no arm can carry a
  // decorator, so nothing ever builds the context.
  //
  // The same mistake as the block forms earlier in this project - assuming a
  // decoration position exists because the thing it would decorate does.
  expect(evaluated('const r = match (1) { when 1: "one"; when _: "other"; }; r;')).toBe('one');
  expect(evaluated('try { eval(\'const r = match (1) { when 1: (do { "one" }); when _: "o"; };\'); "ACCEPTED"; }'
    + ' catch (e) { e.constructor.name; }')).toBe('ACCEPTED');
  expect(evaluated('try { eval(\'function g(c){} const r = match (1) { when 1: @g (do { 1 }); when _: 0; };\'); "ACCEPTED"; }'
    + ' catch (e) { e.constructor.name; }')).toBe('SyntaxError');
});

// -- Block contexts and their clauses --------------------------------------------

test('a loop block context carries its head clauses', () => {
  // #sec-reflection-shape-block. The builder always
  // supported condition, initializer, and update; only `if` and `while` passed
  // them, so a do-while had no condition and a `for` had none of its three. A
  // for-of reflection that cannot say what it binds has lost what distinguishes
  // it from a bare block.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} let i = 0; do @f { i += 1; } while (i < 1); String(c.condition);`)).toBe('i < 1');
  expect(evaluated(`${grab} for (const v of [1]) @f { } String(c.binding);`)).toBe('const v');
  expect(evaluated(`${grab} for (const k in { a: 1 }) @f { } String(c.binding);`)).toBe('const k');
  // The head's three clauses sit in different slots depending on whether the
  // first is a declaration, so both shapes are pinned.
  expect(evaluated(`${grab} for (let i = 0; i < 1; i++) @f { } String(c.condition) + '/' + String(c.update);`)).toBe('i < 1/i++');
  expect(evaluated(`${grab} let j; for (j = 0; j < 1; j++) @f { } String(c.initializer) + '/' + String(c.condition);`)).toBe('j = 0/j < 1');
  // A clause the head omits reads undefined rather than being absent.
  expect(evaluated(`${grab} for (let i = 0; i < 1;) @f { i++; } String(c.update);`)).toBe('undefined');
});

test('a match arm block takes a decorator and reports its clause', () => {
  // #sec-reflection-shape-block. The MatchArmBlock
  // context could not be reached at all: an arm tested for `{` alone, so a
  // leading `@` was an unexpected token. `match` itself parsed fine - it was
  // the decorated arm that did not.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} match (1) { when 1: @f { "one"; } }; c.kind;`)).toBe('MatchArmBlock');
  // `subject` is the match's ARGUMENT, which is the thing an arm's decorator
  // cannot otherwise see.
  expect(evaluated(`${grab} match (1+1) { when 2: @f { "two"; } }; String(c.subject);`)).toBe('1+1');
  expect(evaluated(`${grab} match (2) { when 2: @f { "b"; } }; String(c.pattern);`)).toBe('2');
  // `index` is the clause's position among its siblings.
  expect(evaluated(`${grab} match (2) { when 1: { "a"; } when 2: @f { "b"; } }; String(c.index);`)).toBe('1');
  // A `default` clause has no pattern, and an unguarded one no guard - present
  // and undefined either way, so a reader walks one shape.
  expect(evaluated(`${grab} match (9) { when 1: { "a"; } default: @f { "d"; } }; String(c.pattern);`)).toBe('undefined');
  expect(evaluated(`${grab} match (2) { when 2: @f { "b"; } }; String(c.guard);`)).toBe('undefined');
  // Per ENTRY, as every block decorator is: two calls, two contexts.
  expect(evaluated(`let n = 0; function g(x) { n += 1; } function h() { return match (1) { when 1: @g { 0; } }; } h(); h(); String(n);`)).toBe('2');
});

test('a block decorator runs on every ENTRY', () => {
  // The design does not state this directly; it follows from "a decorator
  // runs when the declaration it
  // decorates is evaluated" - a block inside a loop is evaluated each
  // iteration - and it is what makes a block decorator useful for
  // instrumentation at all.
  expect(evaluated('const l = []; function f(c) { l.push(1); } for (let i = 0; i < 3; i += 1) @f { let a = 1; } String(l.length);')).toBe('3');
  expect(evaluated('const l = []; function f(c) { l.push(1); } for (let i = 0; i < 0; i += 1) @f { let a = 1; } String(l.length);')).toBe('0');
  // A block NOT in a loop runs once, which is what says the count follows the
  // entries rather than being a property of blocks.
  expect(evaluated('const l = []; function f(c) { l.push(1); } @f { let a = 1; } String(l.length);')).toBe('1');
  // THE CONTRAST THAT MAKES IT A DECISION: every other decorator runs once per
  // DECLARATION, however many times the declaration's body runs. A method in a
  // loop-called class is still decorated once.
  expect(evaluated('const l = []; function f(c) { l.push(1); } class A { @f m() {} } '
    + 'const o = new A(); for (let i = 0; i < 3; i += 1) { o.m(); } String(l.length);')).toBe('1');
});
