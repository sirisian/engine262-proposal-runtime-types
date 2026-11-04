import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';

// #sec-refinement-narrowing: a boundary predicate is not an invariant of a
// mutable object. Only stable observations can supply a cross-field proof.
const SHAPE = '{ kind: "email" | "none", email: string | null }';
const STABLE_SHAPE = '{ kind: string, email: string | null }';
const CONDITION = 'if (this.kind === "email") { this.email !== null } else { true }';
const CONTACT = `type Contact = ${SHAPE} where ${CONDITION}; `;
const frozen = (predicate = CONDITION) => `type Shape = ${STABLE_SHAPE}; type Contact = Composite.<Shape> where ${predicate}; `;
const consume = 'function f(c: Contact): string { if (c.kind === "email") { const s: string = c.email; return s; } return "none"; }';
const invoke = 'var input: any = Composite.<Shape>({kind:"email", email:"a@b"}); String(f(input));';

test('a discriminant test still narrows the tested member of an open record', () => {
  expect(evaluated(`${CONTACT} function f(c: Contact): string { if (c.kind === "email") { const k: "email" = c.kind; return k; } return "none"; }
    String(f({kind:"email", email:"a@b"}));`)).toBe('email');
});

test.each([
  `type Contact = ${SHAPE};`,
  CONTACT,
  `type Contact = ${SHAPE} where if (this.kind === "email") { this is { email: string } } else { true };`,
])('an open record supplies no persistent cross-field proof: %s', (declaration) => {
  expectStaticTypeError(`${declaration} ${consume}`);
});

test('an admitted mutable record can temporarily violate its refinement', () => {
  expect(evaluated(`${CONTACT} function f(c: Contact) { c.email = null; return c.email === null; }
    String(f({kind:"email", email:"a@b"}));`)).toBe('true');
});

test('an alias can invalidate the relation before a discriminant test', () => {
  expect(evaluated(`${CONTACT} function f(c: Contact) { const alias: any = c; alias.email = null;
    if(c.kind === "email") return c.email === null; return false; } String(f({kind:"email", email:"a@b"}));`)).toBe('true');
});

test.each([
  CONDITION,
  'if (this.kind === "email") { this is { email: string } } else { true }',
  'if (this.kind !== "none") { this.email is string } else { true }',
  'if (!(this.kind === "none")) { this.email != null } else { true }',
  'if (this.kind === "none") { true } else { this.email !== null }',
  'if (this.kind === "email" && true) { this.email !== null } else { true }',
  'if (false || this.kind === "email") { this.email !== null } else { true }',
  'match (this.kind) { when "email": this.email !== null; default: true; }',
  'match (this.kind) { when "none": true; when "email": this is { email: string }; }',
])('stable composite fields project the selected source branch: %s', (predicate) => {
  expect(evaluated(`${frozen(predicate)} ${consume} ${invoke}`)).toBe('a@b');
});

test('without a deciding test a stable member keeps its declared union', () => {
  expectStaticTypeError(`${frozen()} function f(c: Contact): string { return c.email; }`);
});

test('a skipped refinement branch contributes no fact', () => {
  expectStaticTypeError(`${frozen()} function f(c: Contact): string { if(c.kind === "none") return c.email; return "email"; }`);
});

test('a join loses a fact absent on another incoming branch', () => {
  expectStaticTypeError(`${frozen()} function f(c: Contact): string { if(c.kind === "email") { const s: string = c.email; } return c.email; }`);
});

test('replacing a composite binding drops its projected member facts', () => {
  expectStaticTypeError(`${frozen()} function f(c: Contact, other: Contact): string {
    if(c.kind === "email") { c = other; return c.email; } return "none"; }`);
});

test('a captured rebinding through a call drops projected facts', () => {
  expectStaticTypeError(`${frozen()} function f(c: Contact, other: Contact): string {
    function replace() { c = other; } if(c.kind === "email") { replace(); return c.email; } return "none"; }`);
});

test('a const alias of a mutable record proves no stable fields', () => {
  expectStaticTypeError(`${CONTACT} function f(input: Contact): string { const c = input;
    if(c.kind === "email") return c.email; return "none"; }`);
});

test('a composite does not freeze the ordinary object stored in a field', () => {
  expectStaticTypeError(`type Shape = {kind:string, nested:any};
    type Contact = Composite.<Shape> where if(this.kind === "email"){ this.nested.email !== null }else{true};
    function f(c: Contact): string { if(c.kind === "email") { const x: {email:string|null} = c.nested; return x.email; } return "none"; }`);
});

test('an opaque helper condition is not executed to obtain a branch proof', () => {
  expectStaticTypeError(`function selected(x) { return x === "email"; }
    ${frozen('if(selected(this.kind)){this.email !== null}else{true}')} ${consume}`);
});

test('ordinary makeType callback bodies remain opaque', () => {
  expectStaticTypeError(`type Shape = ${STABLE_SHAPE}; function p(x) { return x.kind !== "email" || x.email !== null; }
    type Contact = Reflect.makeType({kind:"parameterized", base:type Composite.<Shape>, metadata:{where:p}}); ${consume}`);
});


test('a candidate getter can change its result immediately after admission', () => {
  expect(evaluated(`${CONTACT} let reads=0;
    const input = {kind:"email", get email(){ reads++; return reads<=2 ? "ok" : null; }};
    function f(c: Contact) { if(c.kind === "email") return c.email === null; return false; }
    String(f(input));`)).toBe('true');
});

test('a composite base can cross its source refinement boundary directly', () => {
  expect(evaluated(`${frozen()} ${consume} String(f(Composite.<Shape>({kind:"email",email:"a@b"})));`)).toBe('a@b');
});

test('conjunctions project both fields of the selected branch', () => {
  expect(evaluated(`type Shape={kind:string,email:string|null,phone:string|undefined};
    type Contact=Composite.<Shape> where if(this.kind === "both"){this.email!==null && this.phone!==undefined}else{true};
    function f(c: Contact):string { if(c.kind === "both"){const e:string=c.email;const p:string=c.phone;return e+p;}return "none";}
    var input:any=Composite.<Shape>({kind:"both",email:"a",phone:"b"}); f(input);`)).toBe('ab');
});

test('source type assertions use their declaration scope under a shadow', () => {
  expect(evaluated(`type Email=string; ${frozen('if(this.kind === "email"){this.email is Email}else{true}')}
    function f(c:Contact):string { type Email=number; if(c.kind === "email") return c.email;return "none";} ${invoke}`)).toBe('a@b');
});

test('a nested composite data path is stable', () => {
  expect(evaluated(`type Shape={kind:string,nested:{email:string|null}};
    type Contact=Composite.<Shape> where if(this.kind === "email"){this.nested.email!==null}else{true};
    function f(c:Contact):string {if(c.kind === "email")return c.nested.email;return "none";}
    var input:any=Composite.<Shape>({kind:"email",nested:{email:"a@b"}});f(input);`)).toBe('a@b');
});

test('a generic source assertion retains its applied type argument', () => {
  expect(evaluated(`type Contact<T:type>=Composite.<{kind:string,email:T|null}> where if(this.kind === "email"){this.email is T}else{true};
    function f(c:Contact.<string>):string {if(c.kind === "email")return c.email;return "none";}
    var input:any=Composite.<{kind:string,email:string|null}>({kind:"email",email:"a@b"});f(input);`)).toBe('a@b');
});

test('imported source clauses retain private projection provenance', async () => {
  expect(await observeModuleGraph({
    dep: `export type Shape=${STABLE_SHAPE}; export type Contact=Composite.<Shape> where ${CONDITION};`,
    main: `import {Shape,Contact} from "dep"; ${consume}
      var input:any=Composite.<Shape>({kind:"email",email:"a@b"});if(f(input)!=="a@b")throw new Error("projection");`,
  })).toMatchObject({status:'fulfilled',errorClass:undefined,diagnostic:undefined});
});

test('a returning opposite branch leaves the selected refinement facts', () => {
  expect(evaluated(`${frozen()} function f(c:Contact):string {if(c.kind !== "email")return "none";return c.email;} ${invoke}`)).toBe('a@b');
});

test('a shadowed binding cannot inherit an outer receiver projection', () => {
  expectStaticTypeError(`${frozen()} function f(c:Contact,other:Contact):string {
    if(c.kind === "email") { { const c:Contact=other;return c.email; } } return "none"; }`);
});

test('an optional composite field can narrow after its selected presence assertion', () => {
  expect(evaluated(`type Shape={kind:string,email?:string};
    type Contact=Composite.<Shape> where if(this.kind === "email"){this.email!==undefined}else{true};
    function f(c:Contact):string {if(c.kind === "email")return c.email;return "none";}
    var input:any=Composite.<Shape>({kind:"email",email:"a@b"});f(input);`)).toBe('a@b');
});

test('an optional member of an asserted shape does not assert its presence', () => {
  expectStaticTypeError(`${frozen('if(this.kind === "email"){this is {email?:string}}else{true}')} ${consume}`);
});

test('an undecided earlier match guard prevents projection from a later arm', () => {
  expectStaticTypeError(`type Shape={kind:string,email:string|null,flag:boolean};
    type Contact=Composite.<Shape> where match(this.kind){when "email" if (this.flag): true; when "email":this.email!==null;default:true;};
    ${consume}`);
});

test('multiple clauses propagate facts independently of declaration order', () => {
  expect(evaluated(`type Shape={kind:string,email:string|null,phone:string|null};
    type Contact=Composite.<Shape> where if(this.email is string){this.phone!==null}else{true}
      where if(this.kind === "email"){this.email!==null}else{true};
    function f(c:Contact):string {if(c.kind === "email")return c.phone;return "none";}
    var input:any=Composite.<Shape>({kind:"email",email:"a",phone:"b"});f(input);`)).toBe('b');
});

test('an explicit local check is the mutable-record fallback', () => {
  expect(evaluated(`${CONTACT} function f(c:Contact):string { if(c.kind === "email") {
    const email=c.email;if(email!==null)return email; }return "none";} f({kind:"email",email:"a@b"});`)).toBe('a@b');
});

test('punctuation in a field name cannot alias a nested path', () => {
  expect(evaluated(`type Shape={kind:string,"e.mail":string|null};
    type Contact=Composite.<Shape> where if(this.kind === "email"){this["e.mail"]!==null}else{true};
    function f(c:Contact):string {if(c.kind === "email")return c["e.mail"];return "none";}
    var input:any=Composite.<Shape>({kind:"email","e.mail":"a@b"});f(input);`)).toBe('a@b');
});

test('reference rebinding cannot retain the previous composite value facts', () => {
  expectStaticTypeError(`${frozen()} function f(input:Contact,other:Contact):string {
    let ref c=input;if(c.kind === "email"){ref c=other;return c.email;}return "none";}`);
});

test('a fresh discriminant test can reestablish facts after a call', () => {
  expect(evaluated(`${frozen()} function touch(){} function f(c:Contact):string {
    if(c.kind === "email") {touch();if(c.kind === "email")return c.email;}return "none";} ${invoke}`)).toBe('a@b');
});

test('one clause can propagate a reverse-ordered chain of stable assertions', () => {
  expect(evaluated(`type Shape={kind:string,a:string|null,b:string|null,c:string|null};
    type Contact=Composite.<Shape> where
      (match(this.b){when null:true;default:this.c!==null;}) &&
      (match(this.a){when null:true;default:this.b!==null;}) &&
      (match(this.kind){when "email":this.a!==null;default:true;});
    function f(c:Contact):string {if(c.kind === "email")return c.c;return "none";}
    var input:any=Composite.<Shape>({kind:"email",a:"a",b:"b",c:"c"});f(input);`)).toBe('c');
});

test.each(['!(this.email is null)', 'this.email is not null'])('a scalar pattern exclusion projects: %s', (assertion) => {
  expect(evaluated(`${frozen(`if(this.kind === "email"){${assertion}}else{true}`)} ${consume} ${invoke}`)).toBe('a@b');
});

test('literal-pattern decisions retain contextual numeric adaptation', () => {
  expect(evaluated(`type Shape={tag:uint8,email:string|null};
    type Contact=Composite.<Shape> where if(this.tag is 1){this.email!==null}else{true};
    function f(c:Contact):string {if(c.tag === 1)return c.email;return "none";}
    var input:any=Composite.<Shape>({tag:1,email:"a@b"});f(input);`)).toBe('a@b');
});
