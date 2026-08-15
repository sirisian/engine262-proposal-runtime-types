import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * A class declaration evaluated as MODULE code.
 *
 * `Evaluate_ClassDeclaration` resolves the class's own name to write a class
 * decorator's replacement back through the binding, and `ResolveBinding`
 * defaults its strictness argument to *false*. A module Environment Record's
 * GetBindingValue asserts the read is strict - which it always is, since
 * #sec-strict-mode-code makes all class code strict and a module's besides - so
 * the resolve killed the HOST rather than raising any guest error.
 *
 * `class C {}` alone in a module was enough. KNOWN-DIVERGENCES.md D13 attributed
 * the crash to the replacement-decorator pipeline, which merely happened to be
 * the program that reached it.
 */
function evaluateModule(source: string): void {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const realm = new ManagedRealm();
  // The completion arrives on the job queue, so this asserts what the defect
  // actually was: a HOST AssertError thrown OUT of evaluation, which no guest
  // program should be able to cause however it is written.
  realm.evaluateModule(source, 'test.mjs', () => {});
}

test('a class alone in a module does not kill the host', () => {
  // The trailing newline mattered, which is what made this look arbitrary: a
  // class as the LAST token of a module reached the resolve, and one with
  // anything after it did not.
  expect(() => evaluateModule('class C {}')).not.toThrow();
  expect(() => evaluateModule('export class C {}')).not.toThrow();
  expect(() => evaluateModule('class C {}\n')).not.toThrow();
  expect(() => evaluateModule('class C {}\n;')).not.toThrow();
});

test('a class beside other module code is unaffected', () => {
  expect(() => evaluateModule('class C {}\nglobalThis.x = new C();')).not.toThrow();
  expect(() => evaluateModule('class C {}\nclass D extends C {}')).not.toThrow();
  expect(() => evaluateModule('let v = 1;\nclass C { m() { return v; } }')).not.toThrow();
});
