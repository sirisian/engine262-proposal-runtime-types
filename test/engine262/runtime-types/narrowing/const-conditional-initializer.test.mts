import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-narrowing-flow: "the condition of a conditional expression narrows its
 * two branches", in any position. One position was missed. An unannotated
 * `const` asks whether its initializer carries a type, and that question read
 * each arm of a conditional outside the environment its test leaves for it. An
 * arm that depends on the test was typed against the unnarrowed receiver and
 * refused, so
 *
 *   const n = s !== undefined ? s.length : 0;
 *
 * was an early error, where the same initializer of a `let`, of a `const` with
 * an annotation, or as an argument was accepted.
 */
const accepted = (source: string, value: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: true });
  expect(evaluated(source)).toBe(value);
};

test('a conditional that initialises an unannotated const narrows its arms', () => {
  accepted('function f(s: string | undefined): string { const n = s !== undefined ? s.length : 0; return String(n); } f("ab");', '2');
  accepted('reference class R { x: uint8 = 4; } function f(r: R | undefined): string { const n = r !== undefined ? r.x : 0; return String(n); } f(new R());', '4');
  accepted('class P { x: uint8 = 4; } function f(p: P | undefined): string { const n = p !== undefined ? p.x : 0; return String(n); } f(new P());', '4');
  accepted('class P { x: uint8 = 4; } function f(p: P | null): string { const n = p !== null ? p.x : 0; return String(n); } f(new P());', '4');
  accepted('class P { x: uint8 = 4; } function f(p: P | undefined): string { const n = p ? p.x : 0; return String(n); } f(new P());', '4');
  accepted('class P { x: uint8 = 4; } function f(p: P | undefined): string { const n = p === undefined ? 0 : p.x; return String(n); } f(new P());', '4');
  // At the top level of a script, and from a typed Map's get.
  accepted('class P { x: uint8 = 4; } const t = new Map.<string, P>(); t.set("k", new P()); const g = t.get("k"); const r = g !== undefined ? g.x : 7; String(r);', '4');
});

test('...at any depth, and under an operator', () => {
  accepted('class P { x: uint8 = 4; } function f(p: P | undefined, q: P | null): string { const n = (p !== undefined ? p.x : q !== null ? q.x : 0) + 1; return String(n); } f(undefined, new P());', '5');
  accepted('class P { x: uint8 = 4; } function f(p: P | undefined): string { const a = [p !== undefined ? p.x : 0]; return String(a[0]); } f(new P());', '4');
  accepted('class P { x: uint8 = 4; } function f(p: P | undefined): string { const o = { n: p !== undefined ? p.x : 0 }; return String(o.n); } f(new P());', '4');
  accepted('function f(s: string | undefined): string { const n = (s !== undefined ? s.length : 0); return String(n); } f("abc");', '3');
});

test('the forms that were always accepted are unchanged', () => {
  accepted('function f(s: string | undefined): string { let n = s !== undefined ? s.length : 0; return String(n); } f("ab");', '2');
  accepted('function f(s: string | undefined): string { const n: number = s !== undefined ? s.length : 0; return String(n); } f("ab");', '2');
  accepted('function f(s: string | undefined): string { return String(s !== undefined ? s.length : 0); } f("ab");', '2');
  accepted('class P { x: uint8 = 4; } function f(p: P | undefined): string { const ok = p !== undefined && p.x === 4; return String(ok); } f(new P());', 'true');
});

test('an arm that the test does not narrow is still refused', () => {
  expect(observeScript('function f(s: string | undefined, c: boolean): string { const n = c ? s.length : 0; return String(n); }')).toMatchObject({
    bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-undeclared-member' },
  });
  expect(observeScript('function f(s: string | undefined): string { const n = s !== undefined ? 0 : s.length; return String(n); }')).toMatchObject({
    bodyEntered: false, errorClass: 'StaticTypeError',
  });
});
