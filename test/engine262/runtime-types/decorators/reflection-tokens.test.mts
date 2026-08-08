import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-engine-decorator-replacement stage C: the reflection fields.
 *
 * decorators.md gave twelve block contexts an `Expression` it declined to
 * define, and gave ten declarations an `initial` that captures constants only.
 * decoratorreplacement.md defines `Expression` as a TokenStream; this is where
 * both land.
 */

test('a block context carries its BLOCK as tokens', () => {
  expect(evaluated('let f=""; function g(c){ f=Object.getOwnPropertyNames(c).join(","); } @g { let x = 1; } f;'))
    .toBe('kind,label,block');
  expect(evaluated('let t=""; function g(c){ t=c.block.toString(); } @g { let x = 1; } t;'))
    .toBe('{ let x = 1; }');
  // A block is ONE group token whose contents are the statements, so a macro
  // cannot emit an unbalanced body by losing a brace.
  expect(evaluated('let k=""; function g(c){ k=c.block.map(t=>t.kind).join(","); } @g { let x = 1; } k;'))
    .toBe('group');
  expect(evaluated('let k=""; function g(c){ k=c.block[0].tokens.map(t=>t.value).join(" "); } @g { let x = 1; } k;'))
    .toBe('let x = 1 ;');
});

test('the forms that HAVE a condition carry one', () => {
  expect(evaluated('let t=""; function g(c){ t=c.condition.toString(); } if (1 < 2) @g { 1; } t;'))
    .toBe('1 < 2');
  expect(evaluated('let t=""; let n=0; function g(c){ t=c.condition.toString(); } while (n < 1) @g { n+=1; } t;'))
    .toBe('n < 1');
  // The condition belongs to the OWNING statement, which the block node cannot
  // reach - the parser records it beside the block kind, where both are in hand.
  expect(evaluated('let f=""; function g(c){ f=Object.getOwnPropertyNames(c).join(","); } if (true) @g { 1; } f;'))
    .toBe('kind,label,block,condition');
});

test('a form WITHOUT a condition does not carry one', () => {
  // Absent, not *undefined*. **A property that always answers undefined is worse
  // than an absent one** - it claims to report something it never reports.
  expect(evaluated('let h=""; function g(c){ h=String("condition" in c); } @g { 1; } h;')).toBe('false');
  expect(evaluated('let h=""; function g(c){ h=String("condition" in c); } if (true) @g { 1; } h;')).toBe('true');
});

test('`initial` and `initializer` are a VALUE and the EXPRESSION that produced it', () => {
  // Not two spellings of one thing.
  expect(evaluated('let t; function g(c){ t=c.initial+"|"+c.initializer.toString(); } class A { @g x: uint8 = 3; } String(t);'))
    .toBe('3|3');
  // **The whole point of the pair**: decorators.md calls the constants-only
  // limit "a limitation" and defers the Expression that would fix it. A
  // non-constant initializer has no `initial` and a perfectly readable
  // `initializer`.
  expect(evaluated('let t; function g(c){ t=String(c.initial)+"|"+c.initializer.toString(); } class A { @g x: uint8 = f(); } t;'))
    .toBe('undefined|f()');
  expect(evaluated('let t; function g(c){ t=String(c.initial)+"|"+c.initializer.toString(); } class A { m(@g p: uint32 = f()) {} } t;'))
    .toBe('undefined|f()');
});

test('no initializer means no tokens, at both positions', () => {
  // An absent initializer is null in the parse node rather than undefined, and
  // both answer *undefined* here rather than throwing.
  expect(evaluated('let t; function g(c){ t=String(c.initial)+"|"+String(c.initializer); } class A { @g x: uint8; } t;'))
    .toBe('0|undefined');
  expect(evaluated('let t; function g(c){ t=String(c.initial)+"|"+String(c.initializer); } class A { m(@g p: uint32) {} } t;'))
    .toBe('undefined|undefined');
});

test('a stream is an ARRAY, so a macro uses array operations', () => {
  // That is the reason the representation is a flat list with delimited runs
  // grouped: the operations a macro performs are `map`, `find` and `filter`.
  expect(evaluated('let n=-1; function g(c){ n=c.condition.filter(t=>t.kind==="numeric").length; } if (1 < 2) @g { 1; } String(n);'))
    .toBe('2');
  expect(evaluated('let v=""; function g(c){ v=c.condition.find(t=>t.kind==="punctuator").value; } if (1 < 2) @g { 1; } v;'))
    .toBe('<');
});
