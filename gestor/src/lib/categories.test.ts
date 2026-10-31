import { describe, expect, it } from 'vitest';
import { normalize } from './store';

const NEW = ['Trackeamento', 'Edição', 'IA', 'Criação de vídeos', 'Mineração', 'Voice Clone'];

describe('categorias de despesa', () => {
  it('conta nova já vem com as categorias novas', () => {
    const cats = normalize({}).settings.expenseCategories;
    for (const c of NEW) expect(cats).toContain(c);
    expect(cats.at(-1)).toBe('Outros');
  });
  it('lista antiga ganha as novas antes de "Outros", sem duplicar', () => {
    const s = normalize({ settings: { expenseCategories: ['Ferramentas / SaaS', 'ia', 'Outros'] } }).settings;
    expect(s.expenseCategories).toEqual(['Ferramentas / SaaS', 'ia', 'Trackeamento', 'Edição', 'Criação de vídeos', 'Mineração', 'Voice Clone', 'Outros']);
    expect(s.expenseCategoriesVersion).toBe(2);
  });
  it('depois de oferecidas, apagar uma não faz ela voltar', () => {
    const s = normalize({ settings: { expenseCategories: ['Ferramentas / SaaS', 'Outros'], expenseCategoriesVersion: 2 } }).settings;
    expect(s.expenseCategories).toEqual(['Ferramentas / SaaS', 'Outros']);
  });
});
