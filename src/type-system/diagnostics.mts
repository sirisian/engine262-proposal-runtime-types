import type { ParseNode } from '../parser/ParseNode.mts';
import type { ObjectValue } from '../value.mts';
import type { ThrowCompletion } from '../completion.mts';
import { Throw, format, type Formattable } from '../host-defined/error-messages.mts';
import { IsCheckedCode, CheckedCodeOwner } from './checked-code.mts';
import { ResolveBindingDeclaration } from './compile-time-evaluability.mts';
import { TypeDiagnosticCatalog, type TypeDiagnosticCode, type TypeDiagnosticRule } from './diagnostic-catalog.mts';

export type TypeDiagnosticPhase = 'static' | 'pre-evaluation';
export interface TypeDiagnosticLocation {
  readonly start: number;
  readonly end: number;
  readonly nodeType: string;
}
export interface TypeDiagnosticRecord {
  readonly code: TypeDiagnosticCode;
  readonly rule: TypeDiagnosticRule;
  readonly phase: TypeDiagnosticPhase;
  readonly errorClass: 'StaticTypeError';
  readonly checked: boolean;
  readonly applicability: 'always' | 'checked';
  readonly unit?: TypeDiagnosticLocation;
  readonly location?: TypeDiagnosticLocation;
  readonly arguments: readonly string[];
  readonly related: readonly (TypeDiagnosticLocation & { readonly role: 'declaration' | 'origin' })[];
}

const byRule = new Map<TypeDiagnosticRule, typeof TypeDiagnosticCatalog[number]>(TypeDiagnosticCatalog.map((entry) => [entry.rule, entry]));
const records = new WeakMap<object, TypeDiagnosticRecord>();

/** Host diagnostics never add a property to an ECMAScript Error or program object. */
export function TypeDiagnosticOf(error: unknown): TypeDiagnosticRecord | undefined {
  return error !== null && typeof error === 'object' ? records.get(error) : undefined;
}

/** Source ownership is supplied by the obligation, including deferred obligations. */
export function TypeDiagnosticApplies(rule: TypeDiagnosticRule, node: ParseNode): boolean {
  const entry = byRule.get(rule);
  if (!entry) throw new Error(`Unregistered type diagnostic rule: ${rule}`);
  return entry.applicability === 'always' || IsCheckedCode(node);
}

export function CreateTypeDiagnostic(rule: TypeDiagnosticRule, node: ParseNode, phase: TypeDiagnosticPhase,
  message: string, ...args: readonly Formattable[]): ThrowCompletion {
  const entry = byRule.get(rule);
  if (!entry) throw new Error(`Unregistered type diagnostic rule: ${rule}`);
  if (!(entry.phases as readonly string[]).includes(phase)) throw new Error(`Invalid diagnostic phase for ${rule}: ${phase}`);
  const completion = (Throw.StaticTypeError as (message: string, ...args: readonly Formattable[]) => ThrowCompletion)(message, ...args);
  const locate = (source: ParseNode | undefined): TypeDiagnosticLocation | undefined => source?.location
    ? Object.freeze({ start: source.location.startIndex, end: source.location.endIndex, nodeType: source.type }) : undefined;
  const subject = node.type === 'CallExpression' ? node.CallExpression
    : node.type === 'NewExpression' ? node.MemberExpression : node;
  const declaration = subject?.type === 'IdentifierReference'
    ? locate(ResolveBindingDeclaration(subject, subject.name)?.node) : undefined;
  records.set(completion.Value, Object.freeze({
    code: entry.code, rule, phase, errorClass: 'StaticTypeError', checked: IsCheckedCode(node),
    applicability: entry.applicability, unit: locate(CheckedCodeOwner(node)), location: locate(node),
    arguments: Object.freeze(args.map((arg) => format(arg))),
    related: Object.freeze(declaration ? [Object.freeze({ ...declaration, role: 'declaration' as const })] : []),
  }));
  return completion;
}

/** Applicability is decided before allocating or formatting an error. Facts are not changed here. */
export function ReportTypeDiagnostic(errors: ObjectValue[], rule: TypeDiagnosticRule, node: ParseNode,
  phase: TypeDiagnosticPhase, message: string, ...args: readonly Formattable[]): void {
  if (!TypeDiagnosticApplies(rule, node)) return;
  errors.push(CreateTypeDiagnostic(rule, node, phase, message, ...args).Value as ObjectValue);
}
