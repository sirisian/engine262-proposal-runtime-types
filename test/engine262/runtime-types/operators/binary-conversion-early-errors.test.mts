import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "binary symbol *",
    "function f(x:symbol,y:number){x*y;}"
  ],
  [
    "binary symbol * executed",
    "function f(x:symbol,y:number){x*y;} f(Symbol(),2);"
  ],
  [
    "binary symbol +",
    "function f(x:symbol,y:number){x+y;}"
  ],
  [
    "binary symbol + executed",
    "function f(x:symbol,y:number){x+y;} f(Symbol(),2);"
  ],
  [
    "binary symbol -",
    "function f(x:symbol,y:number){x-y;}"
  ],
  [
    "binary symbol - executed",
    "function f(x:symbol,y:number){x-y;} f(Symbol(),2);"
  ],
  [
    "binary symbol /",
    "function f(x:symbol,y:number){x/y;}"
  ],
  [
    "binary symbol / executed",
    "function f(x:symbol,y:number){x/y;} f(Symbol(),2);"
  ],
  [
    "binary symbol %",
    "function f(x:symbol,y:number){x%y;}"
  ],
  [
    "binary symbol % executed",
    "function f(x:symbol,y:number){x%y;} f(Symbol(),2);"
  ],
  [
    "binary symbol **",
    "function f(x:symbol,y:number){x**y;}"
  ],
  [
    "binary symbol ** executed",
    "function f(x:symbol,y:number){x**y;} f(Symbol(),2);"
  ],
  [
    "binary symbol &",
    "function f(x:symbol,y:number){x&y;}"
  ],
  [
    "binary symbol & executed",
    "function f(x:symbol,y:number){x&y;} f(Symbol(),2);"
  ],
  [
    "binary symbol <<",
    "function f(x:symbol,y:number){x<<y;}"
  ],
  [
    "binary symbol << executed",
    "function f(x:symbol,y:number){x<<y;} f(Symbol(),2);"
  ],
  [
    "binary symbol <",
    "function f(x:symbol,y:number){x<y;}"
  ],
  [
    "binary symbol < executed",
    "function f(x:symbol,y:number){x<y;} f(Symbol(),2);"
  ],
  [
    "binary symbol >=",
    "function f(x:symbol,y:number){x>=y;}"
  ],
  [
    "binary symbol >= executed",
    "function f(x:symbol,y:number){x>=y;} f(Symbol(),2);"
  ],
  [
    "binary right symbol",
    "function f(x:number,y:symbol){x*y;}"
  ],
  [
    "binary right symbol executed",
    "function f(x:number,y:symbol){x*y;} f(2,Symbol());"
  ],
  [
    "bigint bool",
    "function f(x:bigint,y:boolean){x*y;}"
  ],
  [
    "bigint bool executed",
    "function f(x:bigint,y:boolean){x*y;} f(2n,true);"
  ],
  [
    "control: bigint bool",
    "function f(x:bigint,b:boolean){x*b;}f(2n,true);"
  ],
  [
    "control: ordinary binary BigInt",
    "function f(x:bigint,n:number){x*n;}"
  ],
  [
    "control: typed member",
    "class C{s:symbol=Symbol();}function f(c:C){c.s*2;}f(new C());"
  ],
  [
    "control: typed return",
    "function s():symbol{return Symbol();}function f(){s()*2;}f();"
  ],
  [
    "edge: right string concatenation prior control",
    "function f(x:symbol){x+\"\";}"
  ]
])('R31 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "control: union bad",
    "function f(x:symbol|number,y:number){x*y;}f(Symbol(),3);"
  ],
  [
    "control: legacy",
    "Symbol()*2;"
  ],
  [
    "control: unrelated annotation",
    "function f(){let x:uint8=1;Symbol()*2;}f();"
  ],
  [
    "control: any",
    "function f(x:any,y:number){x*y;}f(Symbol(),2);"
  ]
])('R31 preserves runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "control: union good",
    "function f(x:symbol|number,y:number){x*y;}f(2,3);"
  ],
  [
    "control: overload",
    "class C{operator*(x:symbol):number{return 1;}}function f(c:C,x:symbol){c*x;}f(new C(),Symbol());"
  ],
  [
    "control: loose equality",
    "function f(x:symbol){return x==2;}f(Symbol());"
  ],
  [
    "control: symbol key",
    "function f(s:symbol){let x={[s]:1};return s in x;}f(Symbol());"
  ],
  [
    "control: number boolean",
    "function f(x:number,b:boolean){x*b;}f(2,true);"
  ],
  [
    "control: typed string coercion",
    "function f(x:uint8,y:string){x*y;}f(uint8(2),\"3\");"
  ]
])('R31 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "all-invalid primitive union",
    "function f(x:symbol|boolean,y:bigint){x*y;}"
  ],
  [
    "parentheses",
    "function f(x:symbol){(x)*2;}"
  ],
  [
    "compound assignment",
    "function f(x:symbol){x*=2;}"
  ],
  [
    "typed const alias",
    "function f(x:symbol){const s=x;s*2;}"
  ]
])('R31 additional early boundary: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "unknown left can dispatch",
    "class C{operator*(x:symbol):number{return 1;}}function f(x:object,s:symbol){x*s;}f(new C(),Symbol());"
  ],
  [
    "union left can dispatch",
    "class C{operator*(x:symbol):number{return 1;}}function f(x:number|C,s:symbol){x*s;}f(new C(),Symbol());"
  ],
  [
    "BigInt literal adoption",
    "function f(x:bigint){return x*2;}f(3n);"
  ],
  [
    "BigInt const literal adoption",
    "const n=2;function f(x:bigint){return x*n;}f(3n);"
  ],
  [
    "BigInt and Number ordering",
    "function f(x:bigint,y:number){return x<y;}f(1n,2);"
  ],
  [
    "BigInt and Boolean ordering",
    "function f(x:bigint,y:boolean){return x<y;}f(0n,true);"
  ]
])('R31 additional ok boundary: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  ['left direct', 'function f(x:bigint){return x*9007199254740993;}String(f(2n));', '18014398509481986'],
  ['right direct', 'function f(x:bigint){return 9007199254740993*x;}String(f(2n));', '18014398509481986'],
  ['const use', 'const K=9007199254740993;function f(x:bigint){return x*K;}String(f(2n));', '18014398509481986'],
  ['constant expression', 'function f():bigint{return 9007199254740992+1;}String(f());', '9007199254740993'],
  ['unary constant expression', 'const K=9007199254740993;function f():bigint{return -K;}String(f());', '-9007199254740993'],
  ['ordinary ordering union', 'function f(x:number|bigint,y:number){return x<y;}String(f(1n,2));', 'true'],
  ['reverse ordinary ordering', 'function f(x:number,y:bigint){return x>=y;}String(f(2,1n));', 'true'],
])('BigInt regression: %s', (_name, source, expected) => {
  expect(evaluated(source)).toBe(expected);
});

test.each([
  'BigInt(1)*2;',
  'const n=BigInt(1);n*2;',
  '1n*2;',
  'function f(x:any){x*2;}f(1n);',
  'let a:[].<number>=[1];let ref x=a[0];a.pop();x*2;',
])('binary conversions preserve the dynamic boundary: %s', (source) => {
  expectThrownKind(source, 'TypeError');
});

test('a constant chooses BigInt only when its contextual union needs it', () => {
  expect(evaluated('const K=9007199254740993;let x:bigint|undefined=K;String(x);')).toBe('9007199254740993');
  expect(evaluated('const K=1;let x:number|bigint=K;typeof x;')).toBe('number');
});
