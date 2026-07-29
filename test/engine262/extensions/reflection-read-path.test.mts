import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators-remaining.md phase three: the REFLECTION READ PATH.
 *
 * `sec-decorators` specifies reflection and decoration as ONE facility under
 * one name, and the read half answered two of forty-one contexts. This is the
 * first step of the plan's staged order: `Reflect.Class`, the whole-class read
 * that every other class-family read hangs off.
 */

test('Reflect.Class reads the class back', () => {
  // decorators.md's `ClassReflection`: `name`, `type`, `abstract`, `metadata`.
  expect(evaluated('class A {} Object.getOwnPropertyNames(Reflect.getReflection.<Reflect.Class, A>()).join(",");')).toBe('kind,name,type,abstract,metadata');
  expect(evaluated('class Named {} String(Reflect.getReflection.<Reflect.Class, Named>().name);')).toBe('Named');
  // `type` is the CONSTRUCTOR itself, asserted by identity rather than by
  // typeof - a fresh function would satisfy `typeof === "function"`.
  expect(evaluated('class A {} String(Reflect.getReflection.<Reflect.Class, A>().type === A);')).toBe('true');
  expect(evaluated('abstract class A {} String(Reflect.getReflection.<Reflect.Class, A>().abstract);')).toBe('true');
  expect(evaluated('class A {} String(Reflect.getReflection.<Reflect.Class, A>().abstract);')).toBe('false');
  // The metadata is the SAME object a decorator wrote to, which is what makes
  // the read path and the metadata channel one facility rather than two.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "m"; } @f class A {} '
    + 'String(Reflect.getReflection.<Reflect.Class, A>().metadata[k]);')).toBe('m');
  expect(evaluated('const k = Symbol("k"); let seen; function f(c) { seen = c.metadata; } @f class A {} '
    + 'String(seen === Reflect.getReflection.<Reflect.Class, A>().metadata);')).toBe('true');
  // A target that names no class is refused rather than answered with an empty
  // reflection.
  expect(evaluated('try { eval("Reflect.getReflection.<Reflect.Class, uint8>();"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('PINNED: the member reads need declaration facts nothing stores', () => {
  // The next step of phase three, and it is NOT more of the same. The FIELD
  // read works by walking the class's INSTANCE LAYOUT - which is why it answers
  // only for a class that HAS a layout, measured here: a `dynamic`-shaped class
  // with an untyped field has none, and the read throws.
  expect(evaluated('class A { a: uint8; } String(typeof Reflect.getReflection.<Reflect.ClassField, A>("a"));')).toBe('object');
  expect(evaluated('class A { a; } try { eval("Reflect.getReflection.<Reflect.ClassField, A>(\\"a\\");"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');

  // A METHOD has no layout slot, so there is nothing equivalent to walk. Its
  // reflection wants `static`, `private`, `protected`, `abstract` and
  // `signatures` - DECLARATION facts that live in the AST at class definition
  // and are recorded nowhere reachable from the type afterwards. So the next
  // step is a per-class record of member declarations, not another lookup.
  expect(evaluated('class A { m() {} } try { eval("Reflect.getReflection.<Reflect.ClassMethod, A>(\\"m\\");"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  expect(evaluated('class A { get v(): uint8 { return 1; } } '
    + 'try { eval("Reflect.getReflection.<Reflect.ClassGetter, A>(\\"v\\");"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  // And the enumerating and indexed forms, which are steps 3 and 4.
  expect(evaluated('class A { a: uint8; } '
    + 'try { eval("Reflect.getReflection.<Reflect.ClassField, A>();"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  expect(evaluated('typeof Reflect.getReflectionByIndex;')).toBe('undefined');
});
