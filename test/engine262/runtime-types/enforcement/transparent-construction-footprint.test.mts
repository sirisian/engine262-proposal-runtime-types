import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';

/**
 * Spec: #sec-elision-stability (transparently constructed classes and the
 * supported source callable flows), #sec-user-defined-operators (index
 * accessors).
 *
 * A global mutation footprint withdraws a declared result only where something
 * that may run before the read can replace the binding. Constructing a class
 * that runs no user code replaces nothing, and the class's declared members are
 * source callables whose bodies the footprint follows, exactly as an object
 * literal's are. So in each program below `n()` keeps its declared `number`, and
 * the `uint32` destination refuses it as it would with no class in the program.
 *
 * Where a member, a later definition or the construction itself may replace `n`
 * through the global object, the read stays withdrawn: the program is accepted,
 * and the run-time admission catches the string the replacement returns.
 */
const declared = 'function n(): number { return 2; }';
const replace = 'globalThis.n = function () { return "s"; };';

function refusedStatically(source: string) {
  const result = observeScript(source);
  expect(result.bodyEntered).toBe(false);
  expect(result.errorClass).toBe('StaticTypeError');
  expect(result.diagnostic).toMatchObject({ rule: 'rt-assignability', phase: 'static' });
}

function caughtAtRunTime(source: string) {
  const result = observeScript(source);
  expect(result.bodyEntered).toBe(true);
  expect(result.errorClass).toBe('TypeError');
}

test('with no class in the program, the declared result is refused where it does not fit', () => {
  refusedStatically(`${declared} const k: uint32 = n();`);
});

test('a class member reads like the same member of an object literal', () => {
  refusedStatically(`const o = { get x() { return 1; } }; ${declared} o.x; const k: uint32 = n();`);
  refusedStatically(`class C { get x() { return 1; } } ${declared} new C().x; const k: uint32 = n();`);
  refusedStatically(`const o = { m() { return 1; } }; ${declared} o.m(); const k: uint32 = n();`);
  refusedStatically(`class C { m() { return 1; } } ${declared} new C().m(); const k: uint32 = n();`);
});

test('construction runs no user code: literal fields, typed fields and static parts', () => {
  refusedStatically(`class C { x = 1; get y() { return this.x; } } ${declared} new C().y; const k: uint32 = n();`);
  refusedStatically(`class C { x: uint8 = 3; } ${declared} new C().x; const k: uint32 = n();`);
  refusedStatically(`class C { static s = 1; static {} get x() { return 1; } } ${declared} new C().x; const k: uint32 = n();`);
  // An imaginary literal makes a fresh complex value; negating one is the built-in negation.
  refusedStatically(`class C { z = 2i; w = -1i; get x() { return 1; } } ${declared} new C().x; const k: uint32 = n();`);
  // A null stored where the annotation admits null converts nothing.
  refusedStatically(`class A {} class C { a: A | null = null; get x() { return 1; } } ${declared} new C().x; const k: uint32 = n();`);
  refusedStatically(`class C { get x() { return 1; } } ${declared} const c = new C(); c.x; const k: uint32 = n();`);
});

test('an index accessor is followed into its body, by index count', () => {
  refusedStatically(`class C { get operator[](i: uint32) { return i; } } ${declared} new C()[0]; const k: uint32 = n();`);
  // The key is read before the accessor runs, so its body cannot reach it.
  refusedStatically(`class C { get operator[](i: uint32) { return String(i); } } ${declared} new C()[(0, n())];`);
});

test('a member that replaces the binding keeps the read withdrawn', () => {
  caughtAtRunTime(`class C { get x() { ${replace} return 1; } } ${declared} new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C { m() { ${replace} } } ${declared} new C().m(); const k: uint32 = n();`);
  caughtAtRunTime(`class C { set x(v) { ${replace} } } ${declared} new C().x = 1; const k: uint32 = n();`);
  caughtAtRunTime(`class C { m() { ${replace} } get x() { this.m(); return 1; } } ${declared} new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C { get x() { return String({ toString() { ${replace} return ''; } }); } } ${declared} new C().x; const k: uint32 = n();`);
});

test('an index accessor that replaces the binding keeps the read withdrawn, in either direction', () => {
  caughtAtRunTime(`class C { get operator[](i: uint32) { ${replace} return i; } } ${declared} new C()[0]; const k: uint32 = n();`);
  caughtAtRunTime(`class C { get operator[](i: uint32) { ${replace} return i; } } ${declared} const c = new C(); c[0]; const k: uint32 = n();`);
  caughtAtRunTime(`class C { get operator[](x: uint32, y: uint32) { ${replace} return x; } } ${declared} new C()[1, 2]; const k: uint32 = n();`);
  caughtAtRunTime(`class C { set operator[](i: uint32, v: number) { ${replace} } } ${declared} new C()[0] = 1; const k: uint32 = n();`);
  caughtAtRunTime(`class C { get operator[](i: uint32) { return 1; } set operator[](i: uint32, v: number) { ${replace} } } ${declared} const c = new C(); c[0] += 1; const k: uint32 = n();`);
});

test('a private member is followed under its own name', () => {
  refusedStatically(`class C { #m() { return 1; } get x() { return this.#m(); } } ${declared} new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C { #m() { ${replace} } get x() { this.#m(); return 1; } } ${declared} new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C { get #p() { ${replace} return 1; } get x() { return this.#p; } } ${declared} new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C { set #p(v) { ${replace} } get x() { this.#p = 1; return 1; } } ${declared} new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C { #f: any = 1; arm() { this.#f = function () { ${replace} }; } run() { this.#f(); } } ${declared} const c = new C(); c.arm(); c.run(); const k: uint32 = n();`);
});

test('a member installed or reached after the class is defined is followed too', () => {
  caughtAtRunTime(`class C {} ${declared} Object.defineProperty(C.prototype, 'x', { get() { ${replace} return 1; } }); new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C {} ${declared} const p = C.prototype; Object.defineProperty(p, 'x', { get() { ${replace} return 1; } }); new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C {} ${declared} const o = new C(); Object.defineProperty(o.constructor.prototype, 'x', { get() { ${replace} return 1; } }); o.x; const k: uint32 = n();`);
  caughtAtRunTime(`class C {} ${declared} Object.defineProperty(Object.prototype, 'x', { get() { ${replace} return 1; }, configurable: true }); new C().x; const k: uint32 = n();`);
  caughtAtRunTime(`class C {} ${declared} const o = new C(); Object.setPrototypeOf(o, { get x() { ${replace} return 1; } }); o.x; const k: uint32 = n();`);
  caughtAtRunTime(`class C { m() { return 1; } } ${declared} C.prototype.m = function () { ${replace} }; new C().m(); const k: uint32 = n();`);
});

test('a constructor alias keeps its class across a transparent construction', () => {
  // #sec-class-value-origin-order: the class-value evidence for `K` survives a
  // construction that has no effect, as it does when nothing runs in between,
  // so `new K()` is an `A` and its `uint8` field is refused for a string.
  refusedStatically('class A { x: uint8 = 1; } let K; K = A; const s: string = new K().x;');
  refusedStatically('class A { x: uint8 = 1; } class T { y = 1; } let K; K = A; new T(); const s: string = new K().x;');
  refusedStatically('{ class A { x: uint8 = 1; } class T { y = 1; } let K; K = A; new T(); const s: string = new K().x; }');
  // A constructor body may replace `K`, so the evidence is withdrawn there.
  expect(observeScript('class A { x: uint8 = 1; } class U { constructor() {} } let K; K = A; new U(); const s: string = new K().x;').completion.Type).toBe('normal');
});

test('a class whose construction or definition may run user code is not transparent', () => {
  caughtAtRunTime(`class C { constructor() { ${replace} } } ${declared} new C(); const k: uint32 = n();`);
  caughtAtRunTime(`class C { x = (globalThis.n = function () { return "s"; }, 1); } ${declared} new C(); const k: uint32 = n();`);
  // A computed initializer runs code even where its annotation names a class.
  expect(observeScript(`class A {} class C { a: A | null = new A(); get x() { return 1; } } ${declared} new C().x; const k: uint32 = n();`).completion.Type).toBe('normal');
  caughtAtRunTime(`class C { static { Object.defineProperty(this.prototype, 'x', { get() { ${replace} return 1; } }); } } ${declared} new C().x; const k: uint32 = n();`);
});

test('a member that runs before a later iteration\'s read keeps it withdrawn', () => {
  caughtAtRunTime(`class C { get x() { ${replace} return 1; } } ${declared} for (let i = 0; i < 2; i++) { const k: uint32 = n(); new C().x; }`);
});
