import { test, expect } from 'vitest';
import { evaluated, evaluatedFlagOff, expectThrownKind, ok } from '../harness.mts';

/**
 * Design: README.md; the declarations are judged through #sec-typed-classes
 * and laid out through #sec-memory-layout.
 *
 * README.md: "An `accessor` field declares a typed field together with a getter
 * and setter over it. It desugars to a private typed field and the matching
 * pair, so the backing field participates in the memory layout, and an
 * undecorated accessor is inlined to a direct field access."
 *
 * This file covers the declaration end to end: the grammar, the desugaring it
 * stands for, and the commitment that the inlining README promises stays
 * unobservable. Each form is asserted by its RESULT rather than by parsing
 * alone, because a declaration that parses and does nothing reads as support
 * while reflecting as `ClassField` and occupying the wrong kind of slot.
 *
 * THE GRAMMAR IS THIS PROPOSAL'S, NOT TC39'S. The `decorators` feature is
 * mutually exclusive with `runtime-types` and is never enabled here. What the
 * two share is the DISAMBIGUATION - `accessor` is not a reserved word, so it is
 * the modifier only when a property name follows on the same line - and that is
 * pure syntax, kept in one place because a rule written twice drifts.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('every form of the declaration parses and works', () => {
  // All four forms of README's grammar, plus the two the shape implies: an
  // accessor need not be typed, and need not be initialized. Each is asserted
  // by its RESULT - a
  // parse-only assertion would now pass against a declaration that parsed and
  // did nothing.
  expect(evaluated('class A { accessor a: uint32 = 5; } String(new A().a);')).toBe('5');
  expect(evaluated('class A { static accessor count: uint32 = 3; } String(A.count);')).toBe('3');
  expect(evaluated('class A { accessor a = 5; } String(new A().a);')).toBe('5');
  expect(evaluated('class A { accessor a: uint32; } String(new A().a);')).toBe('0');
  // A decoration in front of one parses and fires - the CONTEXT it fires with
  // is asserted in accessors-decorator-context.test.mts.
  expect(evaluated('let n = 0; function f(c) { n += 1; } class A { @f accessor a: uint32 = 5; } String(n);')).toBe('1');
  // A PRIVATE accessor is admitted too - see the desugaring section below for
  // what it becomes.
  expect(outcome('class A { accessor #internal: int32 = 0; }')).toBe('ACCEPTED');
});

test('the positions the design refuses stay refused', () => {
  // A decorator precedes a type only where the position has a reflection
  // context, and an accessor's annotation is a FIELD's, not a return's. The
  // accessor grammar must not reopen it.
  expect(outcome('function f(c) {} class A { accessor a: @f uint32 = 5; }')).toBe('SyntaxError');
  // README: abstract fields and accessors "are not part of the proposal". An
  // abstract FIELD is already a SyntaxError, and the accessor inherits it
  // rather than needing a rule of its own - asserted so that a later stage
  // making abstract fields legal does not silently make abstract accessors
  // legal with them.
  expect(outcome('abstract class A { abstract accessor a: uint32; }')).toBe('SyntaxError');
  expect(outcome('abstract class A { abstract a: uint32; }')).toBe('SyntaxError');
});

test('`accessor` is still an ordinary identifier, which is the hazard', () => {
  // `accessor` is not a reserved word. It is the modifier only when a property
  // name follows ON THE SAME LINE; everywhere else it is a name. They pass
  // only because the lookahead is right, which is what makes them worth
  // having.
  expect(evaluated('class A { accessor = 1; } String(new A().accessor);')).toBe('1');
  expect(evaluated('class A { accessor: uint8 = 7; } String(new A().accessor);')).toBe('7');
  expect(evaluated('class A { accessor() { return "m"; } } (new A()).accessor();')).toBe('m');
  expect(evaluated('const accessor = 3; String(accessor);')).toBe('3');
  expect(evaluated('class A { static accessor = 9; } String(A.accessor);')).toBe('9');
  // THE LINE-TERMINATOR CASE, which is the one a careless lookahead breaks: a
  // newline between `accessor` and a name makes them TWO FIELDS, not one
  // accessor. If this regressed it would report the refusal above instead.
  expect(evaluated('class A { accessor\n  a = 1; } const o = new A(); String(o.accessor) + "/" + String(o.a);')).toBe('undefined/1');
});

test('the keyword belongs to the feature, not to the engine', () => {
  // With `runtime-types` off there is no `accessor` modifier at all, so the
  // word is only ever a name. This is what says the grammar was added to THIS
  // proposal rather than to the language.
  expect(evaluatedFlagOff('try { eval("class A { accessor a = 5; }"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('SyntaxError');
  expect(evaluatedFlagOff('class A { accessor = 1; } String(new A().accessor);')).toBe('1');
});

// -- The unreachable context branches --------------------------------------------

/*
 * The unreachable context branches, and the identifier hazard.
 *
 * Two branches of `memberContextKind` could never run, both hidden by an
 * `as unknown as { ... }` cast that INVENTED a shape rather than narrowing a
 * real one, so no field name in it was ever checked.
 *
 *   - `ClassOperator` was decided on an `OperatorName`, which lives only on an
 *     OperatorDefinition - and an OperatorDefinition never reaches
 *     ClassElementEvaluation, because the class body walk intercepts it.
 *   - `ClassAccessor` was decided on an `Accessor` field NO PARSER SETS (the
 *     spelling is `accessor`), and could not have run even spelled correctly,
 *     because `accessor` produces a FIELD DEFINITION while that function is
 *     reached only from the method arm.
 *
 * The function is now typed to the four method forms that actually call it, so
 * a field it reads has to exist on one of them - which is the part that stops
 * this recurring. Removing unreachable code changes no behaviour, and the
 * assertions below are what say so.
 */

test('the contexts that DO come from the member dispatch still do', () => {
  // The three branches left standing, one assertion each. If narrowing the
  // parameter type had changed which branch a member takes, these move.
  const k = 'let k = "NO"; function f(c) { k = c.kind; } ';
  expect(evaluated(`${k} class A { @f m() {} } k;`)).toBe('ClassMethod');
  expect(evaluated(`${k} class A { @f get x() { return 1; } } k;`)).toBe('ClassGetter');
  expect(evaluated(`${k} class A { @f set x(v: uint8) {} } k;`)).toBe('ClassSetter');
  // A field takes the FieldDefinition arm and never consults the member
  // dispatch at all - which is exactly why the accessor decision has to live
  // there when the grammar lands, and not where it used to be written.
  expect(evaluated(`${k} class A { @f a: uint8 = 1; } k;`)).toBe('ClassField');
});

test('an operator still takes its contexts from the class-body interception', () => {
  // The deleted `OperatorName` branch was not load-bearing: an operator's
  // sub-target contexts are named at the interception that registers the
  // operator, which is why removing it changes nothing here.
  const k = 'let k = "NO"; function f(c) { k = c.kind; } ';
  expect(evaluated(`${k} class O { operator +(@f r: O): O { return r; } } k;`)).toBe('ClassOperatorParameter');
  expect(evaluated(`${k} class O { operator +(r: O): @f O { return r; } } k;`)).toBe('ClassOperatorReturn');
});

test('the grammar exists and desugars, which the removed branches predate', () => {
  // A public accessor round-trips. The sections above and below own the
  // detailed assertions; this is the one line saying the declaration form
  // exists at all.
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); o.a = 9; String(o.a);')).toBe('9');
  expect(evaluated('typeof Reflect.ClassAccessor;')).toBe('object');
});

test('`accessor` is an ordinary identifier and must stay one', () => {
  // The hazard the grammar must not break. `accessor` is not a reserved word,
  // and TC39's parser handles it with a lookahead: the keyword reading needs a
  // property name on the SAME LINE after it, so `accessor` alone is a field
  // named `accessor` and `accessor \n x` is too. They pass only if that
  // lookahead was copied correctly.
  expect(evaluated('class A { accessor = 1; } String(new A().accessor);')).toBe('1');
  expect(evaluated('class A { accessor: uint8 = 7; } String(new A().accessor);')).toBe('7');
  expect(evaluated('const accessor = 3; String(accessor);')).toBe('3');
  expect(evaluated('class A { accessor() { return "method"; } } (new A()).accessor();')).toBe('method');
});

// -- The desugaring --------------------------------------------------------------

/*
 * The desugaring.
 *
 * README.md: "It desugars to a private typed field and the matching pair, so
 * the backing field participates in the memory layout, and an undecorated
 * accessor is inlined to a direct field access."
 *
 * THE DESUGARING IS REAL RATHER THAN SPECIAL-CASED, and that is what made it
 * small. The backing is an ordinary field record whose [[Name]] is a Private
 * Name, so `DefineField` initializes it per instance, applies the declared
 * type's DEFAULT where no initializer is written, and hangs the TypeObject on
 * the Private Name - which is what makes `PrivateSet` enforce the type. The
 * setter checks its argument because the field underneath it does, not because
 * this feature added a check.
 *
 * Built on `[[Fields]]` and `ClassFieldDefinitionRecord` throughout: the TC39
 * accessor's records are a reference that was read and never reached.
 */

test('an accessor round-trips, per instance', () => {
  expect(evaluated('class A { accessor a: uint32 = 5; } String(new A().a);')).toBe('5');
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); o.a = 9; String(o.a);')).toBe('9');
  // THE ASSERTION THAT MATTERS FOR STORAGE: two instances do not share it. A
  // round trip on one object passes against a backing stored on the prototype,
  // which is the mistake a "private field" that is not per-instance would make.
  expect(evaluated('class A { accessor a: uint32 = 5; } const x = new A(), y = new A(); x.a = 1; y.a = 2; String(x.a) + "/" + String(y.a);')).toBe('1/2');
  // And the storage is PRIVATE: the instance has no own property, so the
  // backing is not reachable by name, by enumeration, or by `Object.keys`.
  expect(evaluated('class A { accessor a: uint32 = 5; } String(Object.getOwnPropertyNames(new A()).length);')).toBe('0');
  expect(evaluated('class A { accessor a: uint32 = 5; } JSON.stringify(Object.keys(new A()));')).toBe('[]');
});

test('the accessor is TYPED, and the setter enforces it', () => {
  // The reason to write `accessor a: uint8` rather than a hand-written pair.
  // Out of range is a RangeError, not a TypeError, and it arrives
  // through the backing field rather than through anything this stage wrote.
  // Through a `let`: a `const` bound to a construction is now typed, so
  // the setter's range check is reached at COMPILE time and the run-time kind
  // this line asserts never happens. Both are asserted, the early error being
  // the better answer.
  expectThrownKind('class A { accessor a: uint8 = 1; } let o = new A(); o.a = 300;', 'RangeError');
  expect(ok('class A { accessor a: uint8 = 1; } const o = new A(); o.a = 300;')).toBe(false);
  expectThrownKind('class A { accessor a: uint8 = 1; } let o = new A(); o.a = "s";', 'TypeError');
  expect(ok('class A { accessor a: uint8 = 1; } const o = new A(); o.a = "s";')).toBe(false);
  // In range still works, so the check is a check and not a refusal.
  expect(evaluated('class A { accessor a: uint8 = 1; } const o = new A(); o.a = 255; String(o.a);')).toBe('255');
  // A typed accessor with NO initializer takes its type's default, the same
  // rule a typed field follows - not undefined.
  expect(evaluated('class A { accessor a: uint32; } String(new A().a);')).toBe('0');
  // An untyped accessor is untyped, and stores what it is given.
  expect(evaluated('class A { accessor a = 5; } const o = new A(); o.a = "s"; o.a;')).toBe('s');
});

test('the pair is a real getter and setter on the home object', () => {
  // An instance accessor's pair goes on the PROTOTYPE, where a hand-written
  // `get`/`set` pair goes, and is not enumerable.
  expect(evaluated('class A { accessor a: uint32 = 5; } const d = Object.getOwnPropertyDescriptor(A.prototype, "a"); typeof d.get + "/" + typeof d.set + "/" + String(d.enumerable);')).toBe('function/function/false');
  // A static accessor's pair goes on the CONSTRUCTOR, and its backing is the
  // constructor's - so it is one storage rather than one per instance.
  expect(evaluated('class A { static accessor count: uint32 = 3; } A.count = 7; String(A.count);')).toBe('7');
  expect(evaluated('class A { static accessor count: uint32 = 3; } const d = Object.getOwnPropertyDescriptor(A, "count"); typeof d.get + "/" + typeof d.set;')).toBe('function/function');
  // The getter reads through `this`, so it follows the receiver rather than
  // closing over one instance.
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); o.a = 2; const g = Object.getOwnPropertyDescriptor(A.prototype, "a").get; String(g.call(o));')).toBe('2');
});

test('an accessor initializes where a field does, in declaration order', () => {
  // The initializer runs per instance, in source order AMONG THE FIELDS - so an
  // accessor between two fields runs between them. Asserting the whole sequence
  // catches an implementation that ran all fields and then all accessors, which
  // a check on the accessor alone would not.
  const order = 'const l = []; function t(n) { l.push(n); return n; } '
    + 'class A { a: uint8 = t(1); accessor b: uint8 = t(2); c: uint8 = t(3); } new A(); ';
  expect(evaluated(`${order} l.join(",");`)).toBe('1,2,3');
  // And it runs once per instance, not once per class.
  expect(evaluated(`${order} new A(); l.join(",");`)).toBe('1,2,3,1,2,3');
  // The initializer sees `this`, as a field's does.
  expect(evaluated('class A { a: uint8 = 4; accessor b: uint8 = this.a; } String(new A().b);')).toBe('4');
});

test('what the desugaring does not settle', () => {
  // A PRIVATE accessor works - see the test below.

  // A decorated accessor fires with `ClassAccessor`;
  // accessors-decorator-context.test.mts owns the assertions.
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind; } class A { @f accessor a: uint32 = 5; } k;')).toBe('ClassAccessor');

  // Nothing here asserts LAYOUT. README says the backing "participates in the
  // memory layout" and, twenty lines later, that "an accessor doesn't" occupy
  // one; accessors-layout.test.mts settles that. The backing is a private
  // field, so whatever a private field does is what it does.
});


test('a PRIVATE accessor desugars to a backing field AND a private pair', () => {
  // "A private field plus a public pair"
  // becomes a private field plus a PRIVATE pair - two Private Names for one
  // declaration - and the pair is a PrivateElement rather than a property, so
  // one evaluation yields two things: it RETURNS the field record, which
  // allocates the backing slot, and CARRIES the pair for the class to install
  // beside every other private element.
  expect(evaluated('class A { accessor #p: int32 = 7; } "ok";')).toBe('ok');
  expect(evaluated('class A { accessor #p: int32 = 7; get v() { return this.#p; } } String(new A().v);')).toBe('7');
  expect(evaluated('class A { accessor #p: int32 = 7; set w(x) { this.#p = x; } get v() { return this.#p; } } '
    + 'const a = new A(); a.w = 9; String(a.v);')).toBe('9');
  // THE TYPE IS ENFORCED, which is the point of the desugaring being REAL: the
  // backing is an ordinary typed field on a Private Name, so `PrivateSet` does
  // the checking and the setter checks nothing itself.
  expect(evaluated('class A { accessor #p: int32 = 7; set w(x) { this.#p = x; } } '
    + 'const a = new A(); try { a.w = "s"; "NO-CHECK"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  // A STATIC private accessor works the same way.
  expect(evaluated('class A { static accessor #t: uint32 = 3; static get v() { return A.#t; } } String(A.v);')).toBe('3');
  // And nothing leaks: the backing Private Name is unnameable, so an instance
  // has no own property for it.
  expect(evaluated('class A { accessor #p: int32 = 7; } String(Object.getOwnPropertyNames(new A()).length);')).toBe('0');
  // A PUBLIC accessor is unchanged.
  expect(evaluated('class A { accessor p: int32 = 5; } String(new A().p);')).toBe('5');
});

// -- Inlining --------------------------------------------------------------------

/*
 * Inlining: what an accessor's inlining may be observed to do.
 *
 * README: "an undecorated accessor is INLINED TO A DIRECT FIELD ACCESS". Two
 * readings, both with textual support, and they differ in what a program can
 * SEE:
 *
 *   1. An OPTIMIZATION. The pair is always installed and always observable; an
 *      engine may expand the call, and `get a() { return this.#backing; }`
 *      expanded IS a direct field access. README lists "operators, accessors,
 *      and small numeric kernels" among the things "called directly and only
 *      directly", which is the property that makes them inlinable.
 *   2. A SEMANTIC. An undecorated accessor installs no pair at all and is a
 *      data property; a decorated one installs the pair the decorator returned.
 *      README's `inline` section supports this reading too: an `inline`
 *      function's value cannot be taken, and "reading it as a property is a
 *      TypeError".
 *
 * READING 1 HOLDS, and the deciding argument is what reading 2 costs:
 * DECORATING WOULD CHANGE THE CLASS'S OBSERVABLE SHAPE. The same declaration
 * would yield a data property or an accessor pair depending on whether a
 * decorator ran - different `getOwnPropertyDescriptor`, different own-property
 * enumeration, different `Object.keys`. decorators.md requires the `accessor`
 * keyword precisely so that "all decorators see the same context", which is a
 * stability argument; making the SHAPE unstable cuts against the same instinct.
 *
 * So the inlining is unobservable BY CONSTRUCTION, and what this file pins is
 * the commitment that makes it so: the shape does not depend on decoration.
 * The desugaring already works this way; what this section adds is that the
 * decision is guarded rather than implicit.
 */

test('the observable shape does NOT depend on decoration', () => {
  // The assertion section 2.4 turns on. If inlining were semantic these two would
  // differ, and every one of them is a thing a program can branch on.
  const shape = 'const d = Object.getOwnPropertyDescriptor(A.prototype, "a"); '
    + 'typeof d.get + "/" + typeof d.set + "/" + String(d.enumerable) + "/" + String(d.value); ';
  expect(evaluated(`class A { accessor a: uint32 = 5; } ${shape}`)).toBe('function/function/false/undefined');
  expect(evaluated(`function f(c) {} class A { @f accessor a: uint32 = 5; } ${shape}`)).toBe('function/function/false/undefined');
  // Own-property enumeration is the same question from the instance's side: the
  // storage is private either way, so nothing is enumerable and nothing leaks.
  expect(evaluated('class A { accessor a: uint32 = 5; } JSON.stringify(Object.getOwnPropertyNames(new A()));')).toBe('[]');
  expect(evaluated('function f(c) {} class A { @f accessor a: uint32 = 5; } JSON.stringify(Object.getOwnPropertyNames(new A()));')).toBe('[]');
  expect(evaluated('class A { accessor a: uint32 = 5; } JSON.stringify(Object.keys(new A()));')).toBe('[]');
});

test('an accessor is observably an ACCESSOR, not a field', () => {
  // The contrast that gives the test above its meaning: a plain field IS an own
  // data property with a value, and the accessor is neither. Under reading 2 an
  // undecorated accessor would have looked exactly like this.
  expect(evaluated('class A { a: uint32 = 5; } const e = Object.getOwnPropertyDescriptor(new A(), "a"); typeof e.get + "/" + String(e.value);')).toBe('undefined/5');
  expect(evaluated('class A { accessor a: uint32 = 5; } String(Object.getOwnPropertyDescriptor(new A(), "a"));')).toBe('undefined');
  // The pair lives on the prototype, where a hand-written one lives, so it is
  // inherited and shared rather than per instance.
  expect(evaluated('class A { accessor a: uint32 = 5; } const x = new A(), y = new A(); '
    + 'String(Object.getOwnPropertyDescriptor(A.prototype, "a").get === Object.getOwnPropertyDescriptor(A.prototype, "a").get);')).toBe('true');
  // And it still round-trips per instance through that shared pair,
  // which is what says the storage is separate from the pair.
  expect(evaluated('class A { accessor a: uint32 = 5; } const x = new A(), y = new A(); x.a = 1; y.a = 2; String(x.a) + "/" + String(y.a);')).toBe('1/2');
});

test('the pair is reachable, which reading 2 would have forbidden', () => {
  // README's `inline` rule is that an inline function's value cannot be taken -
  // "storing it, passing it as a callback, or reading it as a property is a
  // TypeError". An accessor's generated pair is NOT marked `inline` and is not
  // subject to that: the getter can be read off the descriptor and called.
  // Pinned because it is the sharpest observable difference between the two
  // readings of section 2.4.
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); o.a = 7; '
    + 'const g = Object.getOwnPropertyDescriptor(A.prototype, "a").get; String(g.call(o));')).toBe('7');
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); '
    + 'const s = Object.getOwnPropertyDescriptor(A.prototype, "a").set; s.call(o, 3); String(o.a);')).toBe('3');
});

test('PINNED: `inline` itself is not implemented', () => {
  // The keyword README defines - "a contextual keyword placed before
  // `function`, a method name, or `operator`" - does not parse, and neither
  // does the `@inline` decorator it says sets the same property. So the
  // GUARANTEE side of inlining is unbuilt; what is settled here is only what
  // an accessor's inlining may and may not be observed to do.
  const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome('class A { inline m() { return 1; } }')).toBe('SyntaxError');
  expect(outcome('inline function f() { return 1; }')).toBe('SyntaxError');
});
