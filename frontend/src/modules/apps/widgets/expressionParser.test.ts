import { describe, expect, it } from 'vitest';
import { parseExpression, unparseExpression, ExpressionParseError } from './expressionParser';

describe('parseExpression — basics', () => {
  it('parses a single number', () => {
    expect(parseExpression('42')).toEqual({ type: 'lit', value: 42 });
  });

  it('parses a bare field reference', () => {
    expect(parseExpression('monthly_salary')).toEqual({ type: 'field', name: 'monthly_salary' });
  });

  it('parses an aliased field reference', () => {
    expect(parseExpression('emp.full_name')).toEqual({ type: 'field', name: 'emp.full_name' });
  });

  it('parses a double-quoted string', () => {
    expect(parseExpression('"open"')).toEqual({ type: 'lit', value: 'open' });
  });

  it('parses true / false / null', () => {
    expect(parseExpression('true')).toEqual({ type: 'lit', value: true });
    expect(parseExpression('false')).toEqual({ type: 'lit', value: false });
    expect(parseExpression('null')).toEqual({ type: 'lit', value: null });
  });
});

describe('parseExpression — arithmetic', () => {
  it('parses the canonical daily_cost expression', () => {
    const expr = parseExpression('monthly_salary / 30 * allocation_pct / 100');
    expect(expr).toEqual({
      type: 'op', op: 'div',
      left: {
        type: 'op', op: 'mul',
        left: {
          type: 'op', op: 'div',
          left: { type: 'field', name: 'monthly_salary' },
          right: { type: 'lit', value: 30 },
        },
        right: { type: 'field', name: 'allocation_pct' },
      },
      right: { type: 'lit', value: 100 },
    });
  });

  it('honours parentheses', () => {
    const expr = parseExpression('(monthly_salary / 30) * (allocation_pct / 100)');
    expect(expr).toEqual({
      type: 'op', op: 'mul',
      left: {
        type: 'op', op: 'div',
        left: { type: 'field', name: 'monthly_salary' },
        right: { type: 'lit', value: 30 },
      },
      right: {
        type: 'op', op: 'div',
        left: { type: 'field', name: 'allocation_pct' },
        right: { type: 'lit', value: 100 },
      },
    });
  });

  it('parses unary minus', () => {
    expect(parseExpression('-x')).toEqual({
      type: 'unary', op: 'neg', arg: { type: 'field', name: 'x' },
    });
  });
});

describe('parseExpression — functions', () => {
  it('parses concat with multiple args', () => {
    const expr = parseExpression('concat(first_name, " ", last_name)');
    expect(expr).toEqual({
      type: 'func', func: 'concat',
      args: [
        { type: 'field', name: 'first_name' },
        { type: 'lit', value: ' ' },
        { type: 'field', name: 'last_name' },
      ],
    });
  });

  it('parses if(cond, then, else)', () => {
    const expr = parseExpression('if(amount > 1000, "high", "low")');
    expect(expr).toEqual({
      type: 'func', func: 'if',
      args: [
        { type: 'op', op: 'gt', left: { type: 'field', name: 'amount' }, right: { type: 'lit', value: 1000 } },
        { type: 'lit', value: 'high' },
        { type: 'lit', value: 'low' },
      ],
    });
  });

  it('parses date_diff', () => {
    const expr = parseExpression('date_diff("day", start_date, end_date)');
    expect(expr).toEqual({
      type: 'func', func: 'date_diff',
      args: [
        { type: 'lit', value: 'day' },
        { type: 'field', name: 'start_date' },
        { type: 'field', name: 'end_date' },
      ],
    });
  });
});

describe('parseExpression — numeric helpers', () => {
  it('parses round(x)', () => {
    expect(parseExpression('round(amount)')).toEqual({
      type: 'func', func: 'round',
      args: [{ type: 'field', name: 'amount' }],
    });
  });

  it('parses round(x, 2)', () => {
    expect(parseExpression('round(amount, 2)')).toEqual({
      type: 'func', func: 'round',
      args: [
        { type: 'field', name: 'amount' },
        { type: 'lit', value: 2 },
      ],
    });
  });

  it('parses abs / floor / ceil', () => {
    for (const fn of ['abs', 'floor', 'ceil'] as const) {
      const ast = parseExpression(`${fn}(x)`);
      expect(ast).toEqual({ type: 'func', func: fn, args: [{ type: 'field', name: 'x' }] });
    }
  });

  it('parses pow(base, exp)', () => {
    expect(parseExpression('pow(x, 2)')).toEqual({
      type: 'func', func: 'pow',
      args: [{ type: 'field', name: 'x' }, { type: 'lit', value: 2 }],
    });
  });

  it('parses length(name)', () => {
    expect(parseExpression('length(name)')).toEqual({
      type: 'func', func: 'length',
      args: [{ type: 'field', name: 'name' }],
    });
  });
});

describe('parseExpression — comparison and logical', () => {
  it('parses a > b and c < d', () => {
    const expr = parseExpression('a > b and c < d');
    expect(expr).toEqual({
      type: 'op', op: 'and',
      left: { type: 'op', op: 'gt', left: { type: 'field', name: 'a' }, right: { type: 'field', name: 'b' } },
      right: { type: 'op', op: 'lt', left: { type: 'field', name: 'c' }, right: { type: 'field', name: 'd' } },
    });
  });

  it('parses not x == y', () => {
    const expr = parseExpression('not x == y');
    expect(expr).toEqual({
      type: 'unary', op: 'not',
      arg: { type: 'op', op: 'eq', left: { type: 'field', name: 'x' }, right: { type: 'field', name: 'y' } },
    });
  });
});

describe('parseExpression — errors', () => {
  it('throws on unbalanced parens', () => {
    expect(() => parseExpression('(1 + 2')).toThrow(ExpressionParseError);
  });

  it('throws on unterminated string', () => {
    expect(() => parseExpression('"foo')).toThrow(ExpressionParseError);
  });

  it('throws on trailing tokens', () => {
    expect(() => parseExpression('1 2')).toThrow(ExpressionParseError);
  });

  it('throws on unknown character', () => {
    expect(() => parseExpression('1 # 2')).toThrow(ExpressionParseError);
  });
});

describe('unparseExpression — round-trip', () => {
  const cases = [
    'monthly_salary',
    'emp.full_name',
    '42',
    '-x',
    'monthly_salary / 30 * allocation_pct / 100',
    'concat(first_name, " ", last_name)',
    'if(amount > 1000, "high", "low")',
    'a > b and c < d',
    'not x == y',
  ];

  for (const src of cases) {
    it(`round-trips: ${src}`, () => {
      const ast1 = parseExpression(src);
      const text = unparseExpression(ast1);
      const ast2 = parseExpression(text);
      expect(ast2).toEqual(ast1);
    });
  }
});
