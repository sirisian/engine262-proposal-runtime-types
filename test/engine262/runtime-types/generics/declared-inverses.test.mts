// PLAN-variadic-and-named-generic-arguments.md OQ-18 / typeprogramming.md R15 /
// spec.emu #sec-declared-inverses: rung three's POSITIVE half. A builder that
// declares an inverse - `@inverse(fn)` from std:types, applied to the builder's
// own declaration - lets a parameter reached only through it be inferred: the
// inverse receives the argument's type (a rest's is the tuple of what it
// collects, A1) and returns a PROPOSAL, which binds only after the forward
// verification an explicitly specialized call faces. The association is an
// internal slot set through the live decoration context (B1); the inverse read
// is the resolved overload's (C). Programs import the kit, so these run as
// modules.
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, ModuleCache, setSurroundingAgent } from '#self';

const NL = String.fromCharCode(10);

function bareRealm() {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  return new ManagedRealm({ resolverCache: new ModuleCache() });
}

/** Evaluates `source` as a module; resolves to 'evaluated' or to the thrown error's message. */
function evaluate(source: string): Promise<string> {
  const realm = bareRealm();
  const parsed = realm.compileModule(source, { specifier: 'main' } as never);
  if ((parsed as { Type?: string }).Type === 'throw' || Array.isArray(parsed)) {
    const first = Array.isArray(parsed) ? parsed[0] : (parsed as { Value?: unknown }).Value;
    return Promise.resolve(String((first as { message?: string })?.message ?? first));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NEVER SETTLED'), 10_000);
    // The callback receives the module's evaluation PROMISE object; a throw at
    // the top level is its rejection, and the error is its PromiseResult.
    realm.evaluateModule((parsed as unknown as { Value: never }).Value, undefined, (promise) => {
      clearTimeout(timer);
      const p = promise as { PromiseState?: string, PromiseResult?: { properties?: Map<unknown, { Value?: { stringValue?(): string } }> } };
      if (p.PromiseState === 'rejected') {
        let message = '';
        try {
          for (const [k, d] of (p.PromiseResult?.properties ?? new Map())) {
            if (String((k as { stringValue?(): string })?.stringValue?.() ?? k) === 'message') {
              message = d?.Value?.stringValue?.() ?? '';
            }
          }
        } catch { /* fall through */ }
        resolve('throw: ' + message);
      } else {
        resolve('evaluated');
      }
    });
  });
}

const PRELUDE = 'import { inverse } from "std:types";' + NL
  + 'class Box<T> { v: T; constructor(v: T) { this.v = v; } }' + NL
  + 'function unboxed(Bs) { return Reflect.makeType({ kind: "tuple", elements: Reflect.getReflection(Bs).elements.map((e) => ({ type: Reflect.getReflection(e.type).generic.arguments[0] })) }); }' + NL
  + '@inverse(unboxed)' + NL
  + 'function boxesOf(Ts) { return Reflect.makeType({ kind: "tuple", elements: Reflect.getReflection(Ts).elements.map((e) => { const t = e.type; return { type: type Box.<t> }; }) }); }' + NL;

function assertEq(expr: string, expected: string): string {
  return `if (String(${expr}) !== ${JSON.stringify(expected)}) { throw new Error("got " + String(${expr})); }`;
}

test('a pack reached only through a builder binds through the builder\'s declared inverse (G37, A1)', async () => {
  const src = PRELUDE
    + 'function unpack<...Ts>(...bs: boxesOf(Ts)): string { return Reflect.getReflection(Ts).elements.map((e) => String(e.type)).join(","); }' + NL
    + assertEq('unpack(new Box.<uint8>(1), new Box.<string>("a"))', 'uint.<8>,string');
  expect(await evaluate(src)).toBe('evaluated');
});

test('the same for a SCALAR parameter', async () => {
  const src = 'import { inverse } from "std:types";' + NL
    + 'class Box<T> { v: T; constructor(v: T) { this.v = v; } }' + NL
    + 'function unbox(B) { return Reflect.getReflection(B).generic.arguments[0]; }' + NL
    + '@inverse(unbox)' + NL
    + 'function boxOf(T) { const t = T; return type Box.<t>; }' + NL
    + 'function open<T>(b: boxOf(T)): string { return String(T); }' + NL
    + assertEq('open(new Box.<uint8>(1))', 'uint.<8>');
  expect(await evaluate(src)).toBe('evaluated');
});

// F-AE, pinned (pre-existing, not part of the inverse): with EXPLICIT type
// arguments, a computed parameter type that applies a class - `b: boxOf(T)`
// with `boxOf` yielding `Box.<t>` - is enforced against the binding itself
// (`uint.<8>`) rather than the builder's result (`Box.<uint8>`), so the call
// is refused; an identity builder passes because the two coincide.
test.fails('explicit type arguments through a class-applying builder (F-AE)', async () => {
  const src = 'class Box<T> { v: T; constructor(v: T) { this.v = v; } }' + NL
    + 'function boxOf(T) { const t = T; return type Box.<t>; }' + NL
    + 'function open<T>(b: boxOf(T)): string { return String(T); }' + NL
    + assertEq('open.<uint8>(new Box.<uint8>(1))', 'uint.<8>');
  expect(await evaluate(src)).toBe('evaluated');
});

test('a lying inverse is caught by forward verification, naming the builder and the proposal', async () => {
  const src = 'import { inverse } from "std:types";' + NL
    + 'class Box<T> { v: T; constructor(v: T) { this.v = v; } }' + NL
    + 'function lie(B) { return string; }' + NL
    + '@inverse(lie)' + NL
    + 'function boxOf(T) { const t = T; return type Box.<t>; }' + NL
    + 'function open<T>(b: boxOf(T)): string { return String(T); }' + NL
    + 'open(new Box.<uint8>(1));';
  const result = await evaluate(src);
  expect(result).toContain("boxOf's inverse proposed string");
  expect(result).toContain('supply explicit type arguments for T');
});

test('an inverse that returns no type is refused naming the builder', async () => {
  const src = 'import { inverse } from "std:types";' + NL
    + 'class Box<T> { v: T; constructor(v: T) { this.v = v; } }' + NL
    + 'function junk(B) { return 42; }' + NL
    + '@inverse(junk)' + NL
    + 'function boxOf(T) { const t = T; return type Box.<t>; }' + NL
    + 'function open<T>(b: boxOf(T)): string { return String(T); }' + NL
    + 'open(new Box.<uint8>(1));';
  expect(await evaluate(src)).toContain("boxOf's inverse returned no proposal for T");
});

test('a builder without an inverse still refuses naming the builder (the rung-three contract)', async () => {
  const src = 'class Box<T> { v: T; constructor(v: T) { this.v = v; } }' + NL
    + 'function boxOf(T) { const t = T; return type Box.<t>; }' + NL
    + 'function open<T>(b: boxOf(T)): string { return String(T); }' + NL
    + 'open(new Box.<uint8>(1));';
  expect(await evaluate(src)).toContain('boxOf declares no inverse');
});

test('a multi-slot builder proposes a record keyed by parameter name, verified jointly', async () => {
  const src = 'import { inverse } from "std:types";' + NL
    + 'class Pair<A, B> { a: A; b: B; constructor(a: A, b: B) { this.a = a; this.b = b; } }' + NL
    + 'function unpair(P) { const as = Reflect.getReflection(P).generic.arguments; return { A: as[0], B: as[1] }; }' + NL
    + '@inverse(unpair)' + NL
    + 'function pairOf(A, B) { const a = A; const b = B; return type Pair.<a, b>; }' + NL
    + 'function split<A, B>(p: pairOf(A, B)): string { return String(A) + "/" + String(B); }' + NL
    + assertEq('split(new Pair.<uint8, string>(1, "a"))', 'uint.<8>/string');
  expect(await evaluate(src)).toBe('evaluated');
});

test('Reflect.declareInverse is refused outside a live decoration (B1: a declaration-site fact, not a registry)', async () => {
  const src = 'function f(T) { return T; } function g(B) { return B; }' + NL
    + 'Reflect.declareInverse({ kind: "Function", type: f, metadata: {} }, g);';
  expect(await evaluate(src)).toContain('accepts only the decoration context');
});

test('reflection reports the declared inverse in the builder\'s metadata', async () => {
  // A function's metadata is what its decoration context carries; a second
  // decorator on the same declaration sees the same object.
  const src = 'import { inverse } from "std:types";' + NL
    + 'let seen;' + NL
    + 'function capture(c) { seen = c.metadata; }' + NL
    + 'function unbox(B) { return Reflect.getReflection(B).generic.arguments[0]; }' + NL
    + '@capture' + NL
    + '@inverse(unbox)' + NL
    + 'function boxOf(T) { return T; }' + NL
    + assertEq('seen.inverse === unbox', 'true');
  expect(await evaluate(src)).toBe('evaluated');
});

test('the forward-declaration pattern is untouched: no inverse needed when the builder sits in the return', async () => {
  const src = 'class Box<T> { v: T; constructor(v: T) { this.v = v; } }' + NL
    + 'function boxesOf(Ts) { return Reflect.makeType({ kind: "tuple", elements: Reflect.getReflection(Ts).elements.map((e) => { const t = e.type; return { type: type Box.<t> }; }) }); }' + NL
    + 'function wrap<...Ts>(...xs: Ts): boxesOf(Ts) { return xs.map((x) => new Box(x)); }' + NL
    + assertEq('wrap(1, "a").length', '2');
  expect(await evaluate(src)).toBe('evaluated');
});
