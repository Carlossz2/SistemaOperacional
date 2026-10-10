import { describe, expect, it } from 'vitest';
import { decimalInput, parseDecimal } from './format';

describe('parseDecimal', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1234,56', 1234.56],
    ['5,4', 5.4],
    ['5.4', 5.4],
    ['1.500', 1500],
    ['12.345.678', 12345678],
    ['0.035', 0.035],
    ['0,0013', 0.0013],
    ['R$ 1.000,00', 1000],
    ['1000', 1000],
    [' 27 ', 27],
  ])('%s → %s', (input, expected) => expect(parseDecimal(input)).toBeCloseTo(expected as number, 6));

  it('vazio vira null e lixo vira NaN', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('1,2,3')).toBeNaN();
  });

  it('ida e volta pelo formulário preserva o valor', () => {
    for (const v of [0.0013, 0.035, 5.4, 1234.56, 1500, 0]) expect(parseDecimal(decimalInput(v))).toBe(v);
  });
});

import { normalizeUrl } from './cloud/config';
describe('normalizeUrl', () => {
  it.each([
    ['https://aaxmvsqpanlksfhdfcqv.supabase.co/rest/v1/', 'https://aaxmvsqpanlksfhdfcqv.supabase.co'],
    ['https://aaxmvsqpanlksfhdfcqv.supabase.co/', 'https://aaxmvsqpanlksfhdfcqv.supabase.co'],
    ['aaxmvsqpanlksfhdfcqv.supabase.co', 'https://aaxmvsqpanlksfhdfcqv.supabase.co'],
    ['  https://x.supabase.co/auth/v1  ', 'https://x.supabase.co'],
  ])('%s', (input, out) => expect(normalizeUrl(input)).toBe(out));
});
