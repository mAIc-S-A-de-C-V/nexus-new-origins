/**
 * Tiny recursive-descent parser that turns a textual expression like
 *
 *   monthly_salary / 30 * allocation_pct / 100
 *
 * into the JSON AST the /aggregate endpoint understands. Designed to be
 * readable to analysts (no JSON tree authoring required) and round-
 * trippable: AST → text → AST yields the same AST modulo whitespace.
 *
 * Grammar:
 *   expression = orExpr
 *   orExpr     = andExpr ('or' andExpr)*
 *   andExpr    = cmpExpr ('and' cmpExpr)*
 *   cmpExpr    = addExpr (CMP addExpr)?      where CMP ∈ == != < <= > >=
 *   addExpr    = mulExpr (('+'|'-') mulExpr)*
 *   mulExpr    = unary  (('*'|'/'|'%') unary)*
 *   unary      = '-' unary | 'not' unary | atom
 *   atom       = NUMBER | STRING | TRUE | FALSE | NULL
 *              | identifier
 *              | identifier '(' args? ')'
 *              | '(' expression ')'
 *   args       = expression (',' expression)*
 *   identifier = WORD ('.' WORD)?
 *
 * Strings are double-quoted: "open" — single quotes are not supported
 * to avoid the eternal SQL-escaping rabbit hole at this layer.
 */

import type { Expr } from '../../../types/app';

// ── Errors ────────────────────────────────────────────────────────────────

export class ExpressionParseError extends Error {
  /** Zero-based offset in the source string where the error occurred. */
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

// ── Tokenizer ─────────────────────────────────────────────────────────────

type Tok =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'str'; value: string; pos: number }
  | { kind: 'id'; value: string; pos: number }    // identifier (with optional dot)
  | { kind: 'op';  value: string; pos: number }   // + - * / % == != < <= > >= ( ) , .
  | { kind: 'kw';  value: 'and' | 'or' | 'not' | 'true' | 'false' | 'null'; pos: number }
  | { kind: 'eof'; pos: number };

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null']);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    // Numbers (no leading '-' here — that's a unary op)
    if (c >= '0' && c <= '9') {
      const start = i;
      while (i < src.length && ((src[i] >= '0' && src[i] <= '9') || src[i] === '.')) i++;
      const num = parseFloat(src.slice(start, i));
      if (Number.isNaN(num)) throw new ExpressionParseError(`Invalid number near '${src.slice(start, i)}'`, start);
      out.push({ kind: 'num', value: num, pos: start });
      continue;
    }
    // Double-quoted strings (with backslash escapes for \" and \\)
    if (c === '"') {
      const start = i;
      i++;
      let s = '';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          s += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
        } else {
          s += src[i];
          i++;
        }
      }
      if (i >= src.length) throw new ExpressionParseError('Unterminated string', start);
      i++; // closing quote
      out.push({ kind: 'str', value: s, pos: start });
      continue;
    }
    // Identifiers / keywords
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_.]/.test(src[i])) i++;
      const word = src.slice(start, i);
      if (KEYWORDS.has(word.toLowerCase())) {
        out.push({ kind: 'kw', value: word.toLowerCase() as 'and', pos: start });
      } else {
        out.push({ kind: 'id', value: word, pos: start });
      }
      continue;
    }
    // Operators / punctuation
    // Two-char first: == != <= >=
    if (i + 1 < src.length) {
      const two = src.slice(i, i + 2);
      if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
        out.push({ kind: 'op', value: two, pos: i });
        i += 2;
        continue;
      }
    }
    if ('+-*/%<>(),'.includes(c)) {
      out.push({ kind: 'op', value: c, pos: i });
      i++;
      continue;
    }
    throw new ExpressionParseError(`Unexpected character '${c}'`, i);
  }
  out.push({ kind: 'eof', pos: src.length });
  return out;
}

// ── Parser ────────────────────────────────────────────────────────────────

class Parser {
  pos = 0;
  constructor(public toks: Tok[]) {}

  peek(): Tok { return this.toks[this.pos]; }
  consume(): Tok { return this.toks[this.pos++]; }
  expect(kind: Tok['kind'], value?: string): Tok {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && (t as { value?: string }).value !== value)) {
      throw new ExpressionParseError(
        `Expected ${kind}${value ? ` '${value}'` : ''}, got ${t.kind}${('value' in t) ? ` '${(t as { value: string }).value}'` : ''}`,
        t.pos,
      );
    }
    this.pos++;
    return t;
  }

  parseExpression(): Expr { return this.parseOr(); }

  parseOr(): Expr {
    let left = this.parseAnd();
    let t = this.peek();
    while (t.kind === 'kw' && t.value === 'or') {
      this.consume();
      const right = this.parseAnd();
      left = { type: 'op', op: 'or', left, right };
      t = this.peek();
    }
    return left;
  }

  parseAnd(): Expr {
    let left = this.parseNot();
    let t = this.peek();
    while (t.kind === 'kw' && t.value === 'and') {
      this.consume();
      const right = this.parseNot();
      left = { type: 'op', op: 'and', left, right };
      t = this.peek();
    }
    return left;
  }

  // `not` binds looser than comparisons (matches Python). `not x == y` is
  // therefore parsed as `not (x == y)` rather than `(not x) == y`.
  parseNot(): Expr {
    const t = this.peek();
    if (t.kind === 'kw' && t.value === 'not') {
      this.consume();
      return { type: 'unary', op: 'not', arg: this.parseNot() };
    }
    return this.parseCmp();
  }

  parseCmp(): Expr {
    const left = this.parseAdd();
    const t = this.peek();
    if (t.kind === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.value)) {
      this.consume();
      const right = this.parseAdd();
      const opMap: Record<string, 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'> = {
        '==': 'eq', '!=': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte',
      };
      return { type: 'op', op: opMap[t.value], left, right };
    }
    return left;
  }

  parseAdd(): Expr {
    let left = this.parseMul();
    let t = this.peek();
    while (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      const op = this.consume().kind === 'op' && t.value === '+' ? 'add' : 'sub';
      const right = this.parseMul();
      left = { type: 'op', op: op as 'add', left, right };
      t = this.peek();
    }
    return left;
  }

  parseMul(): Expr {
    let left = this.parseUnary();
    let t = this.peek();
    while (t.kind === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
      const opCh = t.value;
      this.consume();
      const op = opCh === '*' ? 'mul' : opCh === '/' ? 'div' : 'mod';
      const right = this.parseUnary();
      left = { type: 'op', op: op as 'mul', left, right };
      t = this.peek();
    }
    return left;
  }

  parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && t.value === '-') {
      this.consume();
      return { type: 'unary', op: 'neg', arg: this.parseUnary() };
    }
    return this.parseAtom();
  }

  parseAtom(): Expr {
    const t = this.peek();
    if (t.kind === 'num') { this.consume(); return { type: 'lit', value: t.value }; }
    if (t.kind === 'str') { this.consume(); return { type: 'lit', value: t.value }; }
    if (t.kind === 'kw') {
      if (t.value === 'true')  { this.consume(); return { type: 'lit', value: true }; }
      if (t.value === 'false') { this.consume(); return { type: 'lit', value: false }; }
      if (t.value === 'null')  { this.consume(); return { type: 'lit', value: null }; }
    }
    if (t.kind === 'op' && t.value === '(') {
      this.consume();
      const inner = this.parseExpression();
      this.expect('op', ')');
      return inner;
    }
    if (t.kind === 'id') {
      const idTok = t;
      this.consume();
      const next = this.peek();
      // Function call? identifier '(' ...
      if (next.kind === 'op' && next.value === '(' && !idTok.value.includes('.')) {
        this.consume();
        const args: Expr[] = [];
        let lookahead = this.peek();
        if (!(lookahead.kind === 'op' && lookahead.value === ')')) {
          args.push(this.parseExpression());
          lookahead = this.peek();
          while (lookahead.kind === 'op' && lookahead.value === ',') {
            this.consume();
            args.push(this.parseExpression());
            lookahead = this.peek();
          }
        }
        this.expect('op', ')');
        return { type: 'func', func: idTok.value as 'concat', args };
      }
      // Bare identifier — field reference.
      return { type: 'field', name: idTok.value };
    }
    throw new ExpressionParseError(`Unexpected token: ${t.kind}`, t.pos);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export function parseExpression(src: string): Expr {
  const toks = tokenize(src);
  const p = new Parser(toks);
  const expr = p.parseExpression();
  if (p.peek().kind !== 'eof') {
    throw new ExpressionParseError(
      `Trailing tokens after expression at position ${p.peek().pos}`,
      p.peek().pos,
    );
  }
  return expr;
}

/** Convert an AST back to its textual form. Useful for rendering existing
 *  expressions in the editor without re-typing them. */
export function unparseExpression(expr: Expr): string {
  // Precedence levels — higher binds tighter
  const PREC: Record<string, number> = {
    or: 1, and: 2,
    eq: 3, neq: 3, lt: 3, lte: 3, gt: 3, gte: 3,
    add: 4, sub: 4,
    mul: 5, div: 5, mod: 5,
  };
  const SYM: Record<string, string> = {
    add: '+', sub: '-', mul: '*', div: '/', mod: '%',
    eq: '==', neq: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=',
    and: 'and', or: 'or',
  };
  function go(e: Expr, parentPrec = 0): string {
    if (e.type === 'field') return e.name;
    if (e.type === 'lit') {
      if (e.value === null) return 'null';
      if (typeof e.value === 'boolean') return e.value ? 'true' : 'false';
      if (typeof e.value === 'number') return String(e.value);
      // string — quote and escape
      return '"' + e.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }
    if (e.type === 'unary') {
      const inner = go(e.arg, 6);
      return e.op === 'neg' ? `-${inner}` : `not ${inner}`;
    }
    if (e.type === 'op') {
      const myPrec = PREC[e.op] ?? 0;
      const text = `${go(e.left, myPrec)} ${SYM[e.op]} ${go(e.right, myPrec + 1)}`;
      return myPrec < parentPrec ? `(${text})` : text;
    }
    // func
    return `${e.func}(${e.args.map((a) => go(a, 0)).join(', ')})`;
  }
  return go(expr);
}
