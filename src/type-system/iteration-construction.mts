import { ObjectValue, type Value, type PropertyKeyValue } from '../value.mts';
import type { IteratorRecord } from '../abstract-ops/iterator-operations.mts';
import {
  SpreadConstructionOf, CaptureSpreadDataResult, ConstructionSelectionsOf, TransferResultDependency,
} from './result-dependencies.mts';

const intrinsicNextMethods = new WeakSet<ObjectValue>();
type Capture = {
  iterator: ObjectValue, previous?: Capture,
  source: ReturnType<typeof SpreadConstructionOf>,
  result?: { Value: Value },
};
// A frame belongs only to this iterator's direct intrinsic step. User code and
// independent iterators cannot acquire the producing spread's selections.
const captures = new WeakMap<ObjectValue, Capture>();
export function RegisterArrayIteratorNext(method: ObjectValue): void {
  intrinsicNextMethods.add(method);
}
export function BeginIteratorConstruction(record: IteratorRecord, source: Value,
  selections: ReturnType<typeof SpreadConstructionOf>): Capture | undefined {
  if (!selections?.size) return undefined;
  let method = record.NextMethod;
  let receiver: Value = record.Iterator;
  // Built-in bound forwarding invokes no user wrapper. Inner bound receivers
  // override outer ones; use the iterator that the intrinsic actually resumes.
  while (method instanceof ObjectValue && 'BoundTargetFunction' in method) {
    const bound = method as ObjectValue & { BoundTargetFunction: Value, BoundThis: Value };
    receiver = bound.BoundThis;
    method = bound.BoundTargetFunction;
  }
  if (!(method instanceof ObjectValue) || !intrinsicNextMethods.has(method) || !(receiver instanceof ObjectValue)
      || (receiver as ObjectValue & { HostCapturedValues?: readonly Value[] }).HostCapturedValues?.[0] !== source) return undefined;
  const frame: Capture = { iterator: receiver, source: selections, previous: captures.get(receiver) };
  captures.set(receiver, frame);
  return frame;
}
/** Called only by CreateArrayIterator's value branch, at the actual Get result. */
export function CaptureArrayIteratorValue(iterator: ObjectValue, key: PropertyKeyValue, result: { Value: Value }): void {
  const frame = captures.get(iterator);
  if (!frame || frame.result) return;
  CaptureSpreadDataResult(frame.source, key, result.Value, result);
  frame.result = result;
}
export function CompleteIteratorConstruction(frame: Capture | undefined, value: Value, result: object): void {
  if (frame?.result?.Value === value && ConstructionSelectionsOf(frame.result)?.length) {
    TransferResultDependency(frame.result, result);
  }
}
export function EndIteratorConstruction(frame: Capture | undefined): void {
  if (!frame) return;
  if (frame.previous) captures.set(frame.iterator, frame.previous);
  else captures.delete(frame.iterator);
}
