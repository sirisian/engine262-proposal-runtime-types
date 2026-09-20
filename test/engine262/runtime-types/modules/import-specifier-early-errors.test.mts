import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule } from '#self';

function imported(source: string) {
  const imports: string[] = [];
  const agent = new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostLoadImportedModule(referrer, request, _hostDefined, payload) {
        imports.push(request.Specifier);
        FinishLoadingImportedModule(referrer, request, payload, realm.compileModule('export const answer = 42;'));
      },
    },
  });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  expect(realm.evaluateScriptSkipDebugger(source)).toMatchObject({ Type: 'normal' });
  expect(agent.jobQueue?.length ?? 0).toBe(0);
  const completion = realm.evaluateScriptSkipDebugger('String(globalThis.settled);');
  expect(completion).toMatchObject({ Type: 'normal' });
  return { imports, settled: (completion as { Value: { stringValue(): string } }).Value.stringValue() };
}

test.each([
  [
    "symbol specifier unused",
    "function f(x:symbol){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}"
  ],
  [
    "symbol specifier executed",
    "function f(x:symbol){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f(Symbol());"
  ],
  [
    "symbol producing hook unused",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>symbol}){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}"
  ],
  [
    "symbol producing hook executed",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>symbol}){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f({[Symbol.toPrimitive](hint:string):symbol{return Symbol();}});"
  ],
  [
    "nonprimitive hook result unused",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>object}){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}"
  ],
  [
    "nonprimitive hook result executed",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>object}){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f({[Symbol.toPrimitive](hint:string):object{return {};}});"
  ],
  [
    "ordinary exhaustion unused",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>object}){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}"
  ],
  [
    "ordinary exhaustion executed",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>object,valueOf:()=>object}){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f({[Symbol.toPrimitive]:null,toString():object{return {};},valueOf():object{return {};}});"
  ],
  [
    "existing template conversion",
    "function f(x:symbol){`${x}`;}"
  ]
])('R45 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "string import",
    "function f(x:string){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f(\"ok\");",
    "ok",
    [
      "ok"
    ]
  ],
  [
    "number conversion import",
    "function f(x:number){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f(7);",
    "ok",
    [
      "7"
    ]
  ],
  [
    "null conversion import",
    "function f(x:null){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f(null);",
    "ok",
    [
      "null"
    ]
  ],
  [
    "bigint conversion import",
    "function f(x:bigint){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f(7n);",
    "ok",
    [
      "7"
    ]
  ],
  [
    "hook observes string hint",
    "function f(x:{[Symbol.toPrimitive]:(hint:string)=>string}){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f({[Symbol.toPrimitive](hint:string):string{return hint;}});",
    "ok",
    [
      "string"
    ]
  ],
  [
    "partly viable union",
    "function f(x:symbol|string){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f(\"ok\");",
    "ok",
    [
      "ok"
    ]
  ],
  [
    "any runtime",
    "function f(x:any){import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f(Symbol());",
    "TypeError",
    []
  ],
  [
    "legacy runtime",
    "import(Symbol()).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "TypeError",
    []
  ],
  [
    "ordinary const remains legacy",
    "const x=Symbol();import(x).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "TypeError",
    []
  ],
  [
    "explicit String(Symbol) works",
    "function f(x:symbol){import(String(x)).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});}f(Symbol(\"ok\"));",
    "ok",
    [
      "Symbol(ok)"
    ]
  ]
])('R45 preserves import outcomes: %s', (_name, source, settled, imports) => {
  expect(imported(source)).toEqual({ settled, imports });
});

test.each([
  [
    "const typed alias",
    "const s:symbol=Symbol();const a=s;function f(){import(a);}"
  ],
  [
    "void discarded import",
    "function f(s:symbol){void import(s);}"
  ],
  [
    "wrong string hint contract",
    "function f(x:{[Symbol.toPrimitive]:(hint:\"number\")=>string}){import(x);}"
  ],
  [
    "noncallable conversion hook",
    "function f(x:{[Symbol.toPrimitive]:number}){import(x);}"
  ],
  [
    "import result assigned",
    "function f(s:symbol){const p=import(s);}"
  ]
])('R45 rejects a proved edge case: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "unknown conversion hook",
    "function f(x:{[Symbol.toPrimitive]:any}){import(x);}"
  ]
])('R45 accepts a viable edge case: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "ordinary fallback successful",
    "function f(x:{[Symbol.toPrimitive]:null,toString:()=>string,valueOf:()=>object}){import(x).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);}f({[Symbol.toPrimitive]:null,toString():string{return \"fallback\";},valueOf():object{return {};}});",
    "ok",
    [
      "fallback"
    ]
  ]
])('R45 preserves fallback import: %s', (_name, source, settled, imports) => {
  expect(imported(source)).toEqual({ settled, imports });
});
