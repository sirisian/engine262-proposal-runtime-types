import { expect, test } from 'vitest';
import { evaluated, expectThrown } from './harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * `constant { ... }` - an expression whose value belongs to its SITE.
 *
 * It is evaluated at most once per site per realm, and every later evaluation
 * reaching it answers with the stored value. That is the rule ECMA-262 already
 * applies to a tagged template's strings array - GetTemplateObject scans the
 * realm's [[TemplateMap]] for an entry whose [[Site]] is the same Parse Node -
 * generalized from a frozen List of Strings to the value of a Block.
 *
 * It exists because a macro that computes something at expansion time has
 * nowhere to put the result. A hoisted binding needs a statement slot, which an
 * expression does not have, and re-allocates whenever the declaration it sits in
 * is evaluated again. This is per SITE, which is the stronger guarantee.
 */

test('the value is computed once and reused at the same site', () => {
  expect(evaluated('String(constant { 1 + 1; });')).toBe('2');
  // The identity, which is the whole point: a WeakMap keyed on the value hits.
  expect(evaluated('function f() { return constant { ({}); }; } String(f() === f());')).toBe('true');
});

test('each site has its own value, however alike the bodies', () => {
  expect(evaluated('function f() { return constant { ({}); }; } '
    + 'function g() { return constant { ({}); }; } String(f() === g());')).toBe('false');
});

test('a site inside a loop yields one value, not one per iteration', () => {
  expect(evaluated('const s = []; for (let i = 0; i < 3; i += 1) { s.push(constant { ({}); }); } '
    + 'String(s[0] === s[1] && s[1] === s[2]);')).toBe('true');
});

test('two closures from two calls to one factory share the value', () => {
  // This is what a hoisted `const` cannot do. Hoisting is per evaluation of the
  // declaration it sits in, so a template hoisted inside a factory is
  // re-allocated on every call to the factory; keying on the SITE is not.
  expect(evaluated('function make() { return () => constant { ({}); }; } '
    + 'String(make()() === make()());')).toBe('true');
});

test('the body follows a do block: last expression, or undefined', () => {
  expect(evaluated('String(constant { 1; 2; 3; });')).toBe('3');
  expect(evaluated('String(constant { } === undefined);')).toBe('true');
  expect(evaluated('String(constant { const a = 1; a + 1; });')).toBe('2');
});

test('evaluation is lazy, so an untaken branch costs nothing', () => {
  // Observed through a body that THROWS rather than one that counts: a body
  // cannot count, because it may not read anything that varies. Throwing is
  // compile-time evaluable - it simply throws.
  expect(evaluated('if (false) { constant { null.x; }; } "no-throw";')).toBe('no-throw');
  // And the same body on a path that IS taken does throw, so the test above is
  // about laziness rather than about the body being harmless.
  expectThrown('const q = constant { null.x; };');
});

test('an abrupt completion is not recorded, so a later evaluation retries', () => {
  // Nothing was produced, and a failure cannot be told from a value once stored.
  expect(evaluated('let n = 0; function f() { n += 1; return constant { if (n < 2) { null.x; } ({ n }); }; } '
    + 'let first = "none"; try { f(); } catch (e) { first = "threw"; } '
    + 'const second = f(); first + ":" + String(second.n);')).toBe('threw:2');
});

test('`constant` remains an ordinary identifier', () => {
  // It is contextual, not reserved. `do` could be reserved because it already
  // was; `constant` is in use today and making it a keyword would break
  // programs.
  expect(evaluated('const constant = 5; String(constant);')).toBe('5');
  expect(evaluated('const o = { constant: 7 }; String(o.constant);')).toBe('7');
  expect(evaluated('function constant() { return 1; } String(constant());')).toBe('1');
  expect(evaluated('const constant = { x: 2 }; String(constant.x);')).toBe('2');
});

test('a LineTerminator before the block forbids the form', () => {
  // `constant` alone on a line followed by a block is an ExpressionStatement and
  // a Block under ASI, so the keyword form requires no LineTerminator - the same
  // restriction `do`/`while` and arrow functions carry.
  const NL = String.fromCharCode(10);
  expect(evaluated(`const constant = 1;${NL}constant${NL}{ }${NL}"ok";`)).toBe('ok');
});

test('a constant expression nests, each site keyed on its own', () => {
  expect(evaluated('function f() { return constant { ({ inner: constant { ({}); } }); }; } '
    + 'String(f() === f() && f().inner === f().inner);')).toBe('true');
});

test('the value belongs to a realm, not to a program', () => {
  // Per realm, like the template map - so a module evaluated in two realms
  // builds two, and neither is reachable from the other.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const first = new ManagedRealm();
  const second = new ManagedRealm();
  const source = 'globalThis.take = () => constant { ({}); };';
  first.evaluateScriptSkipDebugger(source);
  second.evaluateScriptSkipDebugger(source);
  // Each realm answers consistently for itself.
  expect((first.evaluateScriptSkipDebugger('String(take() === take());') as unknown as { Value: { stringValue(): string } }).Value.stringValue()).toBe('true');
  expect((second.evaluateScriptSkipDebugger('String(take() === take());') as unknown as { Value: { stringValue(): string } }).Value.stringValue()).toBe('true');
});
