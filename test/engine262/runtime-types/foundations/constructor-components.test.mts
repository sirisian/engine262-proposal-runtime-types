import { expect, test } from 'vitest';
import { FindConstructorGrowth, type ConstructorDependency } from '../../../../src/type-system/constructor-growth.mts';

test('deep dependency graphs do not use native recursion for the growth proof', () => {
  const length = 16000;
  const equation = (cyclic: boolean) => (item: number): ConstructorDependency<number>[] => {
    if (item === length - 1) return cyclic ? [{ target: 0, constructed: true }] : [];
    return [{ target: item + 1, constructed: false }];
  };
  expect(FindConstructorGrowth([0], equation(false)).size).toBe(0);
  expect(FindConstructorGrowth([0], equation(true)).size).toBe(length);
});
