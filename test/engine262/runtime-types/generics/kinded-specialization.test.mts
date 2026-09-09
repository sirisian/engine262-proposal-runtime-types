import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A class applied to a HIGHER-KINDED argument specializes, and two such
 * applications are distinct types.
 *
 * #sec-higher-kinded-parameters: "Specialization substitutes a bound declaration
 * for the parameter and then applies it, so a specialized type contains no
 * higher-kinded parameter and the resulting application is an ordinary one. Two
 * applications binding different declarations are distinct types on the same
 * terms as any other pair of applications, and interning follows from that with
 * no rule of its own."
 *
 * The engine did neither. A class with a kinded parameter was EXCLUDED from
 * specialization, on a comment reasoning that a kinded argument "is not
 * resolvable as a type… the nominal instantiation below carries such arguments as
 * it always has". The second half was false: `Reflect.typeOf(new B.<Identity>())`
 * reported bare `B`, so every kinded application of one class was the same type
 * at run time - which the clause forbids in as many words.
 *
 * The checker was never fooled, which is why this went unnoticed: it types
 * `new B.<Id>()` as `B.<Id>` and refuses a mismatch statically, so no program was
 * wrongly accepted. Only reflection disagreed.
 */

const ID = 'type Id<T> = T; type Wrap<T> = [1].<T>; ';
const B = 'class B<W<_>> {} ';

test('a kinded application specializes', () => {
  // The instance is not the base class's: it has the specialization's prototype,
  // which is what carries the methods bound to this application.
  expect(evaluated(`${B} String(Object.getPrototypeOf(new B.<Identity>()) === B.prototype);`)).toBe('false');
  expect(evaluated(`${B} String(Reflect.typeOf(new B.<Identity>()));`)).toBe('B.<Identity>');
});

test('a value\'s type is the annotation\'s type', () => {
  expect(evaluated(`${B} String(type B.<Identity>);`)).toBe('B.<Identity>');
  // The annotation side was always right; this is the side that was not.
  expect(evaluated(`${B} String(Reflect.typeOf(new B.<Identity>()) === (type B.<Identity>));`)).toBe('true');
});

test('two applications binding different declarations are distinct', () => {
  // The clause's own sentence, as a test. This answered *true* before the fix -
  // both collapsed to the unspecialized base.
  expect(evaluated(`${ID}${B} String(Reflect.typeOf(new B.<Id>()) === Reflect.typeOf(new B.<Wrap>()));`)).toBe('false');
  expect(evaluated(`${ID}${B} String((type B.<Id>) === (type B.<Wrap>));`)).toBe('false');
});

test('the checker was already right, and stays right', () => {
  // These passed before the fix too. They are here because they are what made the
  // defect survivable - no program was wrongly ACCEPTED - and because a fix to
  // the runtime side must not disturb them.
  expect(evaluated(`${ID}${B} const b: B.<Id> = new B.<Id>(); "ok";`)).toBe('ok');
  expectThrown(`${ID}${B} const b: B.<Wrap> = new B.<Id>();`, '"B.<Id>" is not assignable to "B.<Wrap>"');
  expectThrown(`${ID}${B} const b: B.<Id> = new B();`, '"B" is not assignable to "B.<Id>"');
});

test('value and type arguments are unchanged', () => {
  // The controls. A fix that reached these would be changing what was already
  // correct: only the kinded case was ever wrong.
  expect(evaluated('class G<N: uint32> { b: [N].<uint8>; } String(Reflect.typeOf(new G.<4>()));')).toBe('G.<4>');
  expect(evaluated('class P<T> { v: T; } String(Reflect.typeOf(new P.<uint8>()));')).toBe('P.<uint.<8>>');
});

test('kinded argument validation is unchanged', () => {
  // Specializing over a kinded argument must not weaken what may BE one. Both
  // messages come from `badKindedArgument`, which the annotation path has always
  // called and which the specializer now reaches the same arguments through.
  expectThrown(`type Two<A, C> = A; ${B} let b: B.<Two>;`,
    '"Two" takes "2" type arguments; "W" expects one taking "1"');
  expectThrown(`${B} let b: B.<uint8>;`,
    '"uint.<8>" is not a generic declaration; "W" expects one taking "1"');
  expect(evaluated(`type One<A> = A; ${B} let b: B.<One>; "ok";`)).toBe('ok');
});
