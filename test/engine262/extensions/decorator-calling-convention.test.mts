import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * proposal-runtime-types #sec-decorator-application, the rest of the clause:
 * "`@f`, `@f(0)`, and `@f('a')` may name three declarations of f and SELECT
 * AMONG THEM THE WAY ANY CALL DOES", and its note - "Types are what remove the
 * `(value, context)` return from a decorator that takes arguments ... giving one
 * an argument is EDITING ITS PARAMETER LIST rather than rewriting it into a
 * factory."
 *
 * Two things had to become true together, which is why they are one cycle.
 *
 * THE CALL. A decoration calls its decorator ONCE, with the written arguments
 * and the context last. The engine had the TC39 FACTORY model instead -
 * `@f(0)` was evaluated as a call and its RESULT applied to the context - so a
 * decorator written the way the clause describes never received a context at
 * all.
 *
 * THE SELECTION. "The way any call does" means the ordinary overload
 * machinery, which is genuinely runtime and value-based: it types each argument
 * through RuntimeTypeOf. A context object reported the plain structural object
 * type any literal reports, so no signature was viable and the LAST declaration
 * ran. A reflection object now REPORTS its context.
 */

const rejectionKind = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "NO-THROW"; } catch (e) { e.constructor.name; }`);

test('a decoration selects among declarations by CONTEXT type', () => {
  // THE DISCRIMINATING FORM, and it is the assertion cycle 129 pinned in its
  // failing direction: the same two declarations must give the same answer in
  // EITHER order. Order-independence is what distinguishes selection from the
  // last declaration happening to be the right one.
  const decls = 'const l = []; function f(c: Reflect.ClassField) { l.push("field:" + String(c.name)); } '
    + 'function f(c: Reflect.Class) { l.push("class:" + String(c.name)); } ';
  const reversed = 'const l = []; function f(c: Reflect.Class) { l.push("class:" + String(c.name)); } '
    + 'function f(c: Reflect.ClassField) { l.push("field:" + String(c.name)); } ';
  expect(evaluated(`${decls} class A { @f a: uint8; } l.join(",");`)).toBe('field:a');
  expect(evaluated(`${reversed} class A { @f a: uint8; } l.join(",");`)).toBe('field:a');
  expect(evaluated(`${decls} @f class N {} l.join(",");`)).toBe('class:N');
  expect(evaluated(`${reversed} @f class N {} l.join(",");`)).toBe('class:N');
  // Three contexts, one name, one class: each position reaches its own
  // declaration, and the ordering rule still holds across them.
  const three = 'const l = []; function f(c: Reflect.ClassField) { l.push("F"); } '
    + 'function f(c: Reflect.ClassMethod) { l.push("M"); } '
    + 'function f(c: Reflect.Class) { l.push("C"); } ';
  expect(evaluated(`${three} @f class A { @f a: uint8; @f m() {} } l.join(",");`)).toBe('F,M,C');
  // A sub-target selects too, which is what makes the parameter and the method
  // distinguishable to one decorator name.
  const sub = 'const l = []; function f(c: Reflect.ClassMethod) { l.push("method"); } '
    + 'function f(c: Reflect.ClassMethodParameter) { l.push("param:" + String(c.index)); } ';
  expect(evaluated(`${sub} class A { @f m(@f p: uint8) {} } l.join(",");`)).toBe('param:0,method');
});

test('the written arguments come first and the context comes last', () => {
  // "Editing its parameter list": the decorator is called once, with what was
  // written and then the context.
  expect(evaluated('let got = "never"; function f(n: uint8, c: Reflect.ClassField) { got = String(n) + ":" + String(c.name); } class A { @f(7) a: uint8; } got;')).toBe('7:a');
  expect(evaluated('let got = "never"; function f(a: uint8, b: string, c: Reflect.ClassField) { got = String(a) + "/" + b + "/" + String(c.name); } class A { @f(1, "x") z: uint8; } got;')).toBe('1/x/z');
  // A decoration also selects on the WRITTEN arguments, not only the context -
  // "the way any call does" is the whole of it.
  const byArg = 'const l = []; function f(n: uint8, c: Reflect.ClassField) { l.push("u8"); } '
    + 'function f(s: string, c: Reflect.ClassField) { l.push("str"); } ';
  expect(evaluated(`${byArg} class A { @f(1) a: uint8; @f("s") b: uint8; } l.join(",");`)).toBe('u8,str');
  // A spread is an ordinary argument list, so it spreads.
  expect(evaluated('let got = "never"; function f(a: uint8, b: uint8, c: Reflect.ClassField) { got = String(a) + "+" + String(b) + ":" + String(c.name); } '
    + 'const xs = [1, 2]; class A { @f(...xs) a: uint8; } got;')).toBe('1+2:a');
});

test('`@f` and `@f()` are one form', () => {
  // The clause says so in as many words: "both resolve with no explicit
  // argument". Under the factory model they were one form for a different
  // reason - the empty call was evaluated and its result applied - and that
  // reason is gone.
  const one = 'const l = []; function f(c: Reflect.ClassField) { l.push(String(c.name)); } ';
  expect(evaluated(`${one} class A { @f a: uint8; @f() b: uint8; } l.join(",");`)).toBe('a,b');
  // And they select the same declaration, which is the part that would break if
  // the empty argument list were treated as an argument.
  const two = 'const l = []; function f(c: Reflect.ClassField) { l.push("noargs"); } '
    + 'function f(n: uint8, c: Reflect.ClassField) { l.push("witharg"); } ';
  expect(evaluated(`${two} class A { @f a: uint8; @f() b: uint8; @f(1) d: uint8; } l.join(",");`)).toBe('noargs,noargs,witharg');
});

test('REST parameters absorb the written arguments and the context', () => {
  // A rest parameter is where the calling convention is most visible, because
  // it shows the whole argument list at once: the written arguments in order,
  // then the context.
  const rest = 'let got = "never"; function f(...all: [].<any>) { got = all.length + "|" + all.slice(0, -1).join(",") + "|" + all[all.length - 1].kind; } ';
  expect(evaluated(`${rest} class A { @f(1, 2) a: uint8; } got;`)).toBe('3|1,2|ClassField');
  // With nothing written, the rest holds the context alone - which is `@f` and
  // `@f()` being one form, seen from inside the callee.
  expect(evaluated(`${rest} class A { @f a: uint8; } got;`)).toBe('1||ClassField');
  expect(evaluated(`${rest} class A { @f() a: uint8; } got;`)).toBe('1||ClassField');
  // A fixed parameter before a rest: the fixed one takes the first written
  // argument, the rest takes what is left AND the context. The context is not
  // special-cased out of the rest, which is the thing worth pinning - it is an
  // ordinary trailing argument.
  const mixed = 'let got = "never"; function f(head: uint8, ...tail: [].<any>) { got = String(head) + "|" + tail.length + "|" + tail[tail.length - 1].kind; } ';
  expect(evaluated(`${mixed} class A { @f(9, 8, 7) a: uint8; } got;`)).toBe('9|3|ClassField');
  expect(evaluated(`${mixed} class A { @f(9) a: uint8; } got;`)).toBe('9|1|ClassField');
  // A rest decorator over a spread, so both ends of the list are dynamic.
  expect(evaluated(`${rest} const xs = [1, 2, 3]; class A { @f(...xs) a: uint8; } got;`)).toBe('4|1,2,3|ClassField');
});

test('DEFAULTS: a written argument overrides one, and the rest is pinned', () => {
  // A default before the context, with the argument written: the written value
  // wins and the context still lands last.
  expect(evaluated('let got = "never"; function f(n: uint8 = 5, c: Reflect.ClassField) { got = String(n) + ":" + String(c.name); } class A { @f(9) a: uint8; } got;')).toBe('9:a');

  // PINNED, and it is the one piece of the clause still outstanding. The
  // preference rule reads: "a signature taking the context alone is PREFERRED
  // over one whose remaining parameters are satisfied by defaults" - which says
  // a signature `f(n = 5, c: Context)` IS a candidate for a bare `@f`, with `n`
  // taking its default and the context landing on `c`.
  //
  // It cannot be, while the context is an ordinary trailing argument: `@f`
  // calls `f(context)` and the context lands on `n`, which refuses it. Making
  // it work means binding the context to the LAST PARAMETER rather than the
  // next position, and that is a real question for the clause rather than an
  // oversight here - it changes what "the way any call does" means, and it
  // interacts with the rest-parameter case above, where the context is
  // deliberately just another trailing argument.
  // (The body reads both parameters so the boundary check is not elided: an
  // unused typed parameter is not enforced, so an empty body would report
  // NO-THROW here and hide the gap rather than pin it.)
  expect(rejectionKind('let seen; function f(n: uint8 = 5, c: Reflect.ClassField) { seen = String(n) + String(c.name); } class A { @f a: uint8; }')).toBe('TypeError');
  // The preference itself is untestable until then: with both declared, the
  // context-alone signature is selected - but by being the only viable one
  // rather than by being preferred.
  const both = 'const l = []; function f(c: Reflect.ClassField) { l.push("alone"); } '
    + 'function f(n: uint8 = 5, c: Reflect.ClassField) { l.push("defaulted"); } ';
  expect(evaluated(`${both} class A { @f a: uint8; } l.join(",");`)).toBe('alone');
});

test('the two phases, now that arguments are part of phase one', () => {
  // "Decorator expressions are evaluated in document order ... Decorators are
  // applied innermost first, and in reverse source order." The arguments belong
  // to the expression, so they are evaluated in phase one - which is what makes
  // the two directions observable without a factory.
  const stacked = 'const log = []; function ev(n) { log.push("eval:" + n); return n; } '
    + 'function tag(n, c) { log.push("apply:" + n); } '
    + 'class A { @tag(ev("outer")) @tag(ev("inner")) a: uint8; } ';
  expect(evaluated(`${stacked} log.join(",");`)).toBe('eval:outer,eval:inner,apply:inner,apply:outer');
  // The CALLEE is evaluated in phase one too, and before its own arguments -
  // observed with a getter, since an ordinary callee has no side effect to see.
  const callee = 'const log = []; const o = { get tag() { log.push("callee"); return (n, c) => log.push("apply:" + n); } }; '
    + 'function ev(n) { log.push("arg"); return n; } '
    + 'class A { @o.tag(ev(1)) a: uint8; } ';
  expect(evaluated(`${callee} log.join(",");`)).toBe('callee,arg,apply:1');
});

test('a reflection object REPORTS its context, and a hand-made one does not', () => {
  // The stamp is what selection reads. It is deliberately narrower than
  // membership: an object with the right shape SATISFIES the context (cycle
  // 129, structural, which is how decorators.md writes them), but only an
  // object this engine built as a reflection REPORTS it. Reading `kind` in
  // RuntimeTypeOf instead would make every `{ kind: "Class" }` in an unrelated
  // program report a nominal type and stop being assignable to the object types
  // it is assignable to today.
  // Type Objects are INTERNED, so the report is checked by identity against the
  // context itself rather than by rendering a name.
  expect(evaluated('let r = "never"; function f(c) { r = String(Reflect.typeOf(c) === Reflect.ClassField); } class A { @f a: uint8; } r;')).toBe('true');
  expect(evaluated('String(Reflect.typeOf({ kind: "ClassField" }) === Reflect.ClassField);')).toBe('false');
  // The hand-made object still satisfies the type, which is the half that did
  // not change.
  expect(evaluated('String({ kind: "ClassField" } is Reflect.ClassField);')).toBe('true');
});
