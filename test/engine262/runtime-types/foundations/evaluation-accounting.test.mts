import { expect, test } from 'vitest';
import type { TypeRecord } from '../../../../src/type-system/records.mts';
import { Agent, ManagedRealm, setSurroundingAgent, GetTypeObject, TypeEvaluationBudget } from '#self';
const {
  BeginTypeEvaluation, EndTypeEvaluation, ConsumeEvaluationSteps, CountTypeConstructionRequest,
  BudgetSpent, BudgetExhaustionKind, IsBudgetExhausted,
  EnterTypeComputation, ExitTypeComputation, InTypeComputation, CurrentTypeComputationSubject,
} = TypeEvaluationBudget;

function context(limits: { steps?: number, records?: number, depth?: number } = {}) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ typeEvaluationBudget: limits } as never);
  const pop = realm.pushTopContext();
  return { agent, realm, pop };
}

test('steps and construction requests allow the exact limit and abandon the next request', () => {
  for (const kind of ['steps', 'records'] as const) {
    for (const ceiling of [0, 1, 2, 17]) {
      const { pop } = context({ [kind]: ceiling });
      BeginTypeEvaluation();
      try {
        const charge = () => kind === 'steps' ? ConsumeEvaluationSteps(1) : CountTypeConstructionRequest();
        for (let i = 0; i < ceiling; i += 1) charge();
        expect(IsBudgetExhausted()).toBe(false);
        expect(BudgetSpent()?.[kind]).toBe(ceiling);
        charge();
        expect(BudgetExhaustionKind()).toBe(kind);
        ConsumeEvaluationSteps(10);
        CountTypeConstructionRequest();
        expect(BudgetExhaustionKind()).toBe(kind);
        expect(BudgetSpent()?.[kind]).toBe(ceiling);
      } finally {
        EndTypeEvaluation();
        pop?.();
      }
    }
  }
});

test('nested evaluations share fuel and a later top-level evaluation starts fresh', () => {
  const { pop } = context({ steps: 3, depth: 2 });
  BeginTypeEvaluation();
  try {
    ConsumeEvaluationSteps(2);
    BeginTypeEvaluation();
    try {
      ConsumeEvaluationSteps(1);
      expect(IsBudgetExhausted()).toBe(false);
    } finally {
      EndTypeEvaluation();
    }
    ConsumeEvaluationSteps(1);
    expect(BudgetExhaustionKind()).toBe('steps');
  } finally {
    EndTypeEvaluation();
  }
  BeginTypeEvaluation();
  try {
    expect(BudgetSpent()).toEqual({ steps: 0, records: 0 });
    expect(IsBudgetExhausted()).toBe(false);
  } finally {
    EndTypeEvaluation();
    pop?.();
  }
});

test('depth includes the root and exhaustion survives unwinding', () => {
  for (const ceiling of [0, 1, 3]) {
    const { pop } = context({ depth: ceiling });
    try {
      for (let i = 0; i < ceiling; i += 1) {
        BeginTypeEvaluation();
        expect(IsBudgetExhausted()).toBe(false);
      }
      BeginTypeEvaluation();
      expect(BudgetExhaustionKind()).toBe('depth');
      EndTypeEvaluation();
      for (let i = 0; i < ceiling; i += 1) {
        expect(BudgetExhaustionKind()).toBe('depth');
        EndTypeEvaluation();
      }
    } finally {
      pop?.();
    }
  }
});

test('construction charges are identical before and after interning', () => {
  const { pop } = context({ records: 1 });
  const record: TypeRecord = { Kind: 'object', Properties: [], IndexSignatures: [] };
  let first: ReturnType<typeof GetTypeObject> | undefined;
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      BeginTypeEvaluation();
      try {
        const value = GetTypeObject(record);
        if (first) expect(value).toBe(first);
        first = value;
        expect(BudgetSpent()).toEqual({ steps: 0, records: 1 });
        expect(IsBudgetExhausted()).toBe(false);
        expect(GetTypeObject(record)).toBe(first);
        expect(BudgetExhaustionKind()).toBe('records');
      } finally {
        EndTypeEvaluation();
      }
    }
  } finally {
    pop?.();
  }
});

test('interleaved agents do not share fuel or active computation subjects', () => {
  const first = context({ steps: 1 });
  BeginTypeEvaluation();
  EnterTypeComputation('first builder');
  ConsumeEvaluationSteps(1);
  const second = context({ steps: 2 });
  try {
    expect(BudgetSpent()).toBeNull();
    expect(InTypeComputation()).toBe(false);
    BeginTypeEvaluation();
    EnterTypeComputation('second builder');
    try {
      ConsumeEvaluationSteps(2);
      expect(IsBudgetExhausted()).toBe(false);
      setSurroundingAgent(first.agent);
      expect(CurrentTypeComputationSubject()).toBe('first builder');
      expect(BudgetSpent()?.steps).toBe(1);
      ConsumeEvaluationSteps(1);
      expect(BudgetExhaustionKind()).toBe('steps');
      setSurroundingAgent(second.agent);
      expect(CurrentTypeComputationSubject()).toBe('second builder');
      expect(IsBudgetExhausted()).toBe(false);
    } finally {
      setSurroundingAgent(second.agent);
      ExitTypeComputation();
      EndTypeEvaluation();
    }
  } finally {
    second.pop?.();
    setSurroundingAgent(first.agent);
    ExitTypeComputation();
    EndTypeEvaluation();
    first.pop?.();
  }
});

test.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('invalid host limit %s cannot disable metering', (steps) => {
  const { pop, realm } = context();
  (realm.HostDefined as unknown as { typeEvaluationBudget: { steps: number } }).typeEvaluationBudget = { steps };
  try {
    expect(() => BeginTypeEvaluation()).toThrow(RangeError);
    expect(BudgetSpent()).toBeNull();
  } finally {
    pop?.();
  }
});
