import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

test('a deep heap path falls back without overflowing operand participation', () => {
  const path = `box${'.next'.repeat(280)}`;
  expect(evaluated(`function f():string{return "old";}globalThis.next=globalThis;const box=globalThis;${path}.f=()=>1;const n:number=f();String(n);`)).toBe('1');
}, 30000);
