import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Spec: #sec-weak-references-and-typed-objects.
 *
 * "The target and unregisterToken of FinalizationRegistry.prototype.register
 * are checked the same way where their Static Type is known;
 * FinalizationRegistry's type parameter is its held value and is
 * unconstrained." A typed receiver is no precondition, and a WeakMap key or a
 * WeakSet value is the same judgment on the same criterion. A bare
 * construction has no Static Type, so the judgment reads the receiver's
 * origin: a fresh construction of the unshadowed intrinsic, direct or through
 * an immutable binding, with the prototype method still the original.
 */

const refused = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-weak-target', phase: 'static' } });
};

test('an untyped registry judges its target and tokens', () => {
  refused('let n: uint8 = 1; const r = new FinalizationRegistry(() => {}); r.register(n, 1);');
  refused('let n: uint8 = 1; const r = new FinalizationRegistry(() => {}); r.register({}, 1, n);');
  refused('let n: uint8 = 1; const r = new FinalizationRegistry(() => {}); r.unregister(n);');
  refused('const t: string = "x"; new FinalizationRegistry(() => {}).register(t, 1);');
});

test('an untyped WeakMap key and WeakSet value are judged', () => {
  refused('let n: uint8 = 1; const m = new WeakMap(); m.set(n, 1);');
  refused('let n: uint8 = 1; new WeakMap().set(n, 1);');
  refused('let s: string = "a"; const w = new WeakSet(); w.add(s);');
});

test('holdable, any, and union arguments are admitted', () => {
  expect(evaluated('const r = new FinalizationRegistry(() => {}); r.register({}, 1); "ok";')).toBe('ok');
  expect(evaluated('const s: symbol = Symbol("a"); const r = new FinalizationRegistry(() => {}); r.register(s, 1); "ok";')).toBe('ok');
  expect(evaluated('let v: any = {}; const r = new FinalizationRegistry(() => {}); r.register(v, 1); "ok";')).toBe('ok');
  expect(evaluated('function f(v: object | symbol) { const r = new FinalizationRegistry(() => {}); r.register(v, 1); } "ok";')).toBe('ok');
  expect(evaluated('const m = new WeakMap(); const o = {}; m.set(o, 1); String(m.get(o));')).toBe('1');
});

test('a shadowed constructor, a patched prototype, and a mutable binding keep the runtime check', () => {
  expect(evaluated('function FinalizationRegistry(cb) { this.register = () => 1; } let n: uint8 = 1; const r = new FinalizationRegistry(() => {}); r.register(n, 1); "ok";')).toBe('ok');
  expect(evaluated('FinalizationRegistry.prototype.register = function () { return 1; }; let n: uint8 = 1; const r = new FinalizationRegistry(() => {}); r.register(n, 1); "ok";')).toBe('ok');
  expect(observeScript('let n: uint8 = 1; let r = new FinalizationRegistry(() => {}); r.register(n, 1);')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});
