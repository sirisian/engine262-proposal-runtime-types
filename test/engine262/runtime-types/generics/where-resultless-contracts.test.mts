import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a result contract requires a declared or published
 * inferred result. A setter and a class constructor declare none, so a
 * contract over `return` on either has nothing to constrain.
 */

const refused = (source: string) => expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-return-contract' } });

test('a constructor or setter result contract is refused', () => {
  refused("class C { constructor(i: uint8) where return > 0 { } } 'ok';");
  refused("class D { set x(v: uint8) where return > 0 { } } 'ok';");
  refused("const o = { set x(v: uint8) where return > 0 { } }; 'ok';");
});

test('members that return a result keep their contracts', () => {
  expect(evaluated('class G { get x(): uint8 where return > 0 { return 1; } } String(new G().x);')).toBe('1');
  expect(evaluated('class S { static constructor(): uint8 where return > 0 { return 1; } } String(S.constructor());')).toBe('1');
  expect(evaluated('const o = { constructor(): uint8 where return > 0 { return 1; } }; String(o.constructor());')).toBe('1');
  expect(evaluated("class C { constructor(i: uint8) where i > 0 { } } new C(1); 'ok';")).toBe('ok');
});
