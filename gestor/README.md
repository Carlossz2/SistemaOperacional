# Gestor DR — controle financeiro da operação de Direct Response

Micro SaaS de uso próprio para controlar uma operação de infoprodutos/DR vendendo no Brasil e no exterior:
faturamento, taxas, reembolsos, tráfego pago, despesas, impostos, lucro, ROAS/ROI/CPA, caixa e capital — tudo
convertido para a moeda base (BRL) com a cotação do dia de cada lançamento.

## Módulos

| Tela | O que faz |
|---|---|
| **Dashboard** | 12 KPIs com variação vs. período anterior (lucro, bruto, líquido, ads, ROAS, ROI, margem, CPA, vendas/ticket, despesas, impostos, reembolso), lucro diário, receita × ads, lucro acumulado, desempenho por produto/país/fonte, despesas por categoria e caixa estimado. Filtros por período, produto e país. |
| **Receitas** | Vendas por dia, produto, plataforma (Hotmart, Kiwify, ClickBank, Digistore24…), país e moeda; bruto, taxas e reembolsos/chargebacks. Venda a venda ou consolidado diário. |
| **Tráfego pago** | Investimento por dia, fonte (Meta, Google, TikTok, Taboola…), campanha, produto e país. |
| **Despesas** | Custos únicos ou **mensais recorrentes** (ferramentas, equipe, criativos, contador…), opcionalmente atribuídos a um produto. |
| **Caixa & capital** | Aportes, retiradas/pró-labore e investimentos em ativos — não são custo, mas mexem no caixa. |
| **Produtos** | Ofertas (front, upsell, order bump…) com **CPA máximo** — o sistema destaca quando estoura. |
| **Relatórios** | **DRE gerencial mês a mês** e quebras por produto, país, plataforma e fonte. Exporta CSV (abre no Excel). |
| **Configurações** | Moeda base, cotações (com atualização online), alíquota de imposto, listas e **backup/restauração**. |

Todas as listas exportam CSV; lançamentos podem ser duplicados para hoje com um clique (agiliza o lançamento diário).

## Como os números são calculados

```
Receita líquida   = Bruto − Taxas − Reembolsos
Impostos          = Receita líquida × alíquota (Configurações)
Lucro líquido     = Receita líquida − Ads − Despesas − Impostos
ROAS              = Bruto ÷ Ads          (ROAS líquido = Líquido ÷ Ads)
ROI               = Lucro ÷ (Ads + Despesas)
CPA               = Ads ÷ Nº de vendas
Margem            = Lucro ÷ Bruto
Caixa estimado    = Aportes + Lucro acumulado − Retiradas − Investimentos
```

- Com filtro de **produto**, entram só as despesas atribuídas a ele. Com filtro de **país** (ou nas quebras por
  país/plataforma/fonte), despesas fixas não entram: o resultado é **margem de contribuição**.
- Cada lançamento em moeda estrangeira guarda a **cotação do dia**; mudar a cotação padrão não altera o passado.

## Rodar localmente

```bash
cd gestor
npm install
npm run dev        # http://localhost:5173
npm test           # testes do motor de cálculo
npm run build      # gera gestor/dist (site estático)
```

## App instalável (PWA)

O Gestor DR é um PWA: pode ser instalado no computador (Chrome/Edge) e no celular (Android e iPhone), com ícone
próprio, janela própria e funcionamento **offline**.

- **Computador / Android**: abra o endereço publicado e clique em *Instalar* (ícone na barra de endereço, botão
  “Instalar app” no menu lateral ou em *Configurações*).
- **iPhone / iPad**: abra no Safari → *Compartilhar* → *Adicionar à Tela de Início*.

Arquivos: `public/manifest.webmanifest`, `public/sw.js` (cache offline; atualiza sozinho quando há versão nova),
`public/icons/` e `src/lib/pwa.ts` (registro e botão de instalação). A instalação exige HTTPS — GitHub Pages,
Vercel ou Netlify servem.

## Publicar (integração GitHub)

- **CI**: todo push/PR que mexe em `gestor/` roda typecheck, testes e build (`.github/workflows/gestor-ci.yml`).
- **GitHub Pages**: em *Settings → Pages* escolha *Source: GitHub Actions*. Depois disso, todo push na branch
  principal que altere `gestor/` publica o app automaticamente (ou rode o workflow
  *“Gestor DR — Publicar no GitHub Pages”* na aba *Actions*). Endereço: `https://<usuario>.github.io/<repositorio>/`.
  (Pages em repositório privado exige plano pago do GitHub.)
- **Vercel/Netlify** (alternativa grátis com repositório privado): importe o repositório, *Root directory* = `gestor`,
  build `npm run build`, saída `dist`.

## Onde ficam os dados

Os dados ficam no **navegador** (localStorage) — nada vai para servidor, então mesmo publicado em URL pública
ninguém vê seus números. Consequência: cada navegador/computador tem sua própria base. **Exporte o backup
(Configurações) com frequência**; o mesmo arquivo restaura os dados em outra máquina.

A camada de dados está isolada em `src/lib/store.ts` para permitir trocar por um backend com login
(ex.: Supabase) sem mexer nas telas.

## Estrutura

```
src/lib/types.ts     modelo de dados
src/lib/metrics.ts   motor de cálculo (P&L, séries, quebras, caixa) + metrics.test.ts
src/lib/store.ts     persistência e CRUD
src/lib/period.tsx   período/filtros globais
src/pages/           telas
src/components/      tabela/formulário genérico, gráficos, KPIs
```

## Próximos passos sugeridos

1. Backend com login (Supabase) para acessar de qualquer dispositivo e com sócios.
2. Importação automática: webhooks/CSV de Hotmart, Kiwify, ClickBank, Digistore24 e gasto via API do Meta/Google Ads.
3. Metas mensais e alertas (lucro, ROAS mínimo, CPA).
4. Fluxo de caixa projetado (saques pendentes das plataformas, D+30 etc.).
