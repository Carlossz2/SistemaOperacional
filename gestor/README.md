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

**Na nuvem (Supabase)** — recomendado e necessário para integrações. Passo a passo em **[GUIA.md](GUIA.md)**.

- Acesso exclusivo do administrador: a primeira conta criada é a única; o banco recusa novos cadastros.
- Verificação em duas etapas (TOTP) exigida pelo próprio banco quando ativada; saída automática por inatividade.
- Cada usuário só acessa os próprios dados (RLS); vendas automáticas e gastos da Meta são somente leitura no app.
- Toda alteração entra numa fila salva no aparelho antes de ir ao servidor: sem internet, nada se perde.
- Webhooks: o conteúdo bruto de cada notificação é gravado antes de qualquer processamento e nunca é apagado;
  eventos repetidos ou fora de ordem não duplicam nem desfazem reembolsos; dá para reprocessar.

**Só no navegador (modo local)** — para testar sem nuvem; não disponível quando o app é publicado com o Supabase embutido.

## Integrações

| Origem | Como | O que entra |
|---|---|---|
| Hotmart, Cakto, Lastlink, GGCheckout, PerfectPay | Webhook (URL secreta por integração + segredo da plataforma) | Vendas, reembolsos e chargebacks, por produto, país e moeda |
| Qualquer outra plataforma | Webhook com mapeamento de campos configurável | Idem |
| Meta Ads | Marketing API (token de usuário do sistema, `ads_read`), de hora em hora | Gasto diário por campanha e país, com regras campanha → produto |

## Testes

```bash
cd gestor && npm test                                   # cálculos e formatos
deno test -A supabase/functions/_shared                 # adaptadores das plataformas
supabase/tests/run.sh                                   # banco: segurança, consolidação, 2FA
supabase/tests/stack/start.sh && deno test -A supabase/tests/stack/backend.e2e.test.ts   # ponta a ponta
```

## Estrutura

```
src/lib/types.ts     modelo de dados
src/lib/metrics.ts   motor de cálculo (P&L, séries, quebras, caixa) + metrics.test.ts
src/lib/store.ts     estado e CRUD (local ou nuvem)
src/lib/cloud/       Supabase: conexão, fila offline, tempo real, conversão de dados
../supabase/         banco (migrations), Edge Functions (webhook, reprocess, meta-sync) e testes
src/lib/period.tsx   período/filtros globais
src/pages/           telas
src/components/      tabela/formulário genérico, gráficos, KPIs
```

## Próximos passos sugeridos

1. Metas mensais e alertas (lucro, ROAS mínimo, CPA).
2. Fluxo de caixa projetado (saques pendentes das plataformas, D+30 etc.).
3. Google Ads / TikTok Ads.
