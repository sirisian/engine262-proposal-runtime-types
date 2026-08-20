import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-null-and-undefined-types (The null and undefined Types),
 * #sec-void-type (The void Type), #sec-runtimetypeof.
 *
 * `undefined` is "the type whose one value is *undefined*", described by
 * { [[Kind]]: ~primitive~, [[Name]]: *"undefined"* }, and the clause states
 * outright that it "is distinct from the `void` type: `void` is the type with
 * no values, written to say that a result must not be depended on, whereas
 * `undefined` has the one value *undefined* and a binding may hold it."
 *
 * The implementation resolved the `undefined` type NAME to ~void~ and had
 * RuntimeTypeOf report ~void~ for the value, on the reasoning that this kept
 * the two in agreement. They agreed on a type with no values, so a value was
 * not a member of the type its own RuntimeTypeOf reported, and three things
 * fell over at once:
 *
 *   1. `let x: undefined = undefined;` was a TypeError.
 *   2. Every `T | undefined` union was uninhabitable - the union the same
 *      clause names as "the position an erased system reaches with an
 *      optional", and the type that return inference publishes for a function
 *      that can fall off its end.
 *   3. `function f(): void { return; }` was a TypeError while the identical
 *      `function f(): void { }` passed, because the return check tested
 *      *undefined* against ~void~ - contradicting that clause's own note, "A
 *      call of a function whose return type is `void` evaluates to
 *      *undefined*, as a call of a function with no `return` statement does
 *      today."
 *
 * `void` keeps its meaning throughout: no binding may hold a `void` result.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

function expectTypeError(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

/**
 * The completion value of _source_, as a string. Values are checked this way
 * rather than with an in-script `if (c !== 10) throw`, because the checker
 * decides a comparison between a typed binding and a literal statically and
 * reports the guarded branch as dead code - which is correct, and which would
 * make the assertion test the diagnostic rather than the value.
 */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

test('a binding may hold undefined at the undefined type', () => {
  expectOk('let x: undefined = undefined;');
  expectOk('let x: undefined = undefined; x = undefined;');
  expectTypeError('let x: undefined = 5;');
  expectTypeError('let x: undefined = null;');
});

test('the optional union T | undefined is inhabitable from both sides', () => {
  expectOk('let x: uint32 | undefined = undefined;');
  expectOk('let x: uint32 | undefined = 5;');
  expectOk('let x: uint32 | undefined = 5; x = undefined; x = 7;');
  expectOk('let x: string | undefined = undefined;');
  expectOk('let o: { a: uint32 | undefined } = { a: undefined };');
  expectTypeError('let x: uint32 | undefined = "s";');
});

test('undefined is distinct from void, which no binding may hold', () => {
  expectTypeError('function f(): void { } const x: undefined = f();');
  expectTypeError('let x: undefined = undefined; const y: void = x;');
});

test('a void return accepts an explicit bare return', () => {
  // The two spellings of the same function must agree; the annotation
  // constrains the consumer, not the value leaving the function.
  expectOk('function f(): void { } f();');
  expectOk('function f(): void { return; } f();');
  expectOk('function f(): void { if (true) { return; } } f();');
});

test('RuntimeTypeOf reports the undefined type for undefined', () => {
  expect(value('let u: undefined = undefined; `${Reflect.typeOf(u) === Reflect.typeOf(undefined)}`;')).toBe('true');
  // Interned: two spellings of the annotation are the same Type Object.
  expect(value('let a: undefined = undefined; let b: undefined = undefined; `${Reflect.typeOf(a) === Reflect.typeOf(b)}`;')).toBe('true');
});

test('nullish coalescing works over an optional union', () => {
  // The nullish half of the `??` test is the `undefined` TYPE; built over
  // ~void~ it shared no member with `uint32 | undefined`, so this live code
  // was reported as a test that can never succeed.
  expect(value('let x: uint32 | undefined = undefined; const c: uint32 = x ?? 10; `${c}`;')).toBe('10');
  expect(value('let x: uint32 | undefined = 5; const c: uint32 = x ?? 10; `${c}`;')).toBe('5');
  // A left operand that cannot be nullish is still reported.
  expectTypeError('let x: uint32 = 5; const c = x ?? 10;');
});

test('narrowing an optional union reaches the non-undefined arm', () => {
  expectOk('let x: uint32 | undefined = 5; if (x !== undefined) { const y: uint32 = x; }');
  expectOk("let x: uint32 | undefined = 5; if (typeof x === 'undefined') { } ");
  expectOk('let o: { a?: uint32 } = { }; let v = o.a;');
});

test('a function that can fall off its end returns undefined into the optional union', () => {
  // The shape return-type inference publishes for a mixed fall-off body:
  // `uint32 | undefined`. Inference itself is a later cycle; what this pins is
  // that the published type is inhabitable by the value the call produces.
  expectOk('function v(b) { if (b) { return 5; } } let r: number | undefined = v(false);');
  expectOk('function v(b) { if (b) { return 5; } } let r: number | undefined = v(true);');
});

test('null is a primitive type named for its value', () => {
  // #sec-null-and-undefined-types: `null` is described by
  // { [[Kind]]: ~primitive~, [[Name]]: *"null"* }. It was represented as a
  // literal over `object`, which worked and reported itself as "a literal type
  // of object" in every diagnostic - so a mistake at a `null` annotation named
  // a type the program never wrote.
  expectTypeError('let x: null = 5;');
  expectTypeError('let x: null = null; const s: string = x;');
  // The diagnostic names `null` rather than a type the program never wrote.
  expect(value('try { eval("let x: null = 5;"); } catch (e) { `${e.message}`; }')).toContain('"null"');
  // Everything the old representation carried still holds.
  expectOk('let x: null = null;');
  expectOk('let x: uint32 | null = null; x = 5;');
  expectOk('let x: uint32 | null = null; if (x !== null) { const y: uint32 = x; }');
  // A nullable union defaults to null, and a plain `null` binding does too.
  expect(value('let x: uint32 | null; `${x}`;')).toBe('null');
  expect(value('let a: [].<uint8> | null; `${a}`;')).toBe('null');
  expect(value('let x: null; `${x}`;')).toBe('null');
  // A recursive alias terminated by `| null` still has a finite layout.
  expect(value('type L = { v: uint8, next: L | null }; let l: L = { v: 1, next: null }; `${l.v}`;')).toBe('1');
  // And `using` accepts it, disposing nothing.
  expectOk('{ using r: null = null; }');
});
