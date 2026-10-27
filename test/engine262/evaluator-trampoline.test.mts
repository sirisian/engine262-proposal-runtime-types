import { expect, test } from 'vitest';
import { CallEvaluator, ResumeEvaluator, skipDebugger, type Evaluator } from '#self';

test('abstract-operation recursion uses a work stack and preserves return values', () => {
  function* descend(depth: number): Evaluator<number> {
    return depth ? 1 + (yield* CallEvaluator(descend(depth - 1))) : 0;
  }
  expect(skipDebugger(descend(10_000))).toBe(10_000);
});

test('native exceptions unwind suspended parents without becoming language completions', () => {
  const failure = new Error('host interruption');
  let cleaned = 0;
  function* descend(depth: number): Evaluator<void> {
    try {
      if (!depth) throw failure;
      yield* CallEvaluator(descend(depth - 1));
    } finally {
      cleaned++;
    }
  }
  expect(() => skipDebugger(descend(1000))).toThrow(failure);
  expect(cleaned).toBe(1001);
});

test('debugger suspensions resume the correct independent continuation', () => {
  function* inner(value: number): Evaluator<number> {
    const resumed = yield { suspend: 'debugger' };
    expect(resumed.resume).toBe('debugger');
    return value;
  }
  function* outer(value: number): Evaluator<number> {
    return 1 + (yield* CallEvaluator(inner(value)));
  }
  const first = outer(10);
  const second = outer(20);
  const resume = { resume: 'debugger' as const, value: undefined };
  expect(ResumeEvaluator(first, resume)).toEqual({ done: false, value: { suspend: 'debugger' } });
  expect(ResumeEvaluator(second, resume)).toEqual({ done: false, value: { suspend: 'debugger' } });
  expect(ResumeEvaluator(first, resume)).toEqual({ done: true, value: 11 });
  expect(ResumeEvaluator(second, resume)).toEqual({ done: true, value: 21 });
});
