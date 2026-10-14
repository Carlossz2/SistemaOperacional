# Guia de configuração — CADIGITAL (Supabase + GitHub)

Siga na ordem. Tempo estimado: 30–40 minutos. Nenhum passo exige instalar nada no seu computador.

> **Regra de ouro de segurança:** a única chave que pode ir para o app é a **pública** (anon / publishable).
> A senha do banco, o token de acesso do Supabase e a chave `service_role` ficam **somente** nos Secrets do GitHub.
> Nunca cole esses valores em chat, e-mail ou no código.

---

## 1. Criar o projeto no Supabase

1. Acesse **supabase.com** → *New project*.
2. **Region:** *South America (São Paulo)*. **Database password:** gere uma senha forte e guarde num gerenciador de senhas.
3. Quando o projeto terminar de criar, anote:
   - **Project ref:** o código na URL do painel (`supabase.com/dashboard/project/<REF>`).
   - **Project URL:** *Project Settings → API* → `https://<REF>.supabase.co`.
   - **Chave pública:** *Project Settings → API Keys* → a **Publishable key** (`sb_publishable_…`). A chave `anon` da aba *Legacy API keys* também funciona.
4. Crie um **token de acesso pessoal** em *Account → Access Tokens* (supabase.com/dashboard/account/tokens). Ele permite que o GitHub publique o banco e as funções.

## 2. Configurar o GitHub (uma vez)

No repositório: **Settings → Secrets and variables → Actions**.

**Aba *Secrets*** (valores sigilosos):

| Nome | Valor |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | token de acesso pessoal (passo 1.4) |
| `SUPABASE_DB_PASSWORD` | senha do banco (passo 1.2) |
| `SUPABASE_PROJECT_REF` | o *Project ref* (passo 1.3) |

**Aba *Variables*** (valores públicos, vão para o app):

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://<REF>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | a chave `anon` pública |

Depois: **Settings → Pages → Source: GitHub Actions**.

## 3. Publicar

Com o código na branch principal do repositório, dois processos rodam sozinhos (aba **Actions**):

- **CADIGITAL — Backend (Supabase):** testa tudo, cria as tabelas, regras de segurança e funções no seu projeto.
- **CADIGITAL — Publicar no GitHub Pages:** publica o app em `https://<usuario>.github.io/<repositorio>/`.

Se algum aparecer em vermelho, abra-o e veja o passo que falhou (geralmente um segredo digitado errado). Dá para rodar de novo pelo botão *Run workflow*.

## 4. Criar a conta de administrador (primeiro acesso)

1. No Supabase: **Authentication → URL Configuration → Site URL** = o endereço do app (passo 3). Isso faz o e-mail de confirmação apontar para o lugar certo.
2. Abra o app. Como ainda não há administrador, ele mostra **"Criar conta de administrador"**.
3. Use seu e-mail e uma senha forte (mínimo 12 caracteres). Confirme pelo link que chegar no e-mail e entre.
4. **Pronto: a partir daqui ninguém mais consegue criar conta.** O banco recusa qualquer novo cadastro — mesmo por fora do app.
5. Camada extra (recomendado): **Authentication → Sign In / Providers → desligue "Allow new users to sign up"**.

## 5. Ativar a verificação em duas etapas (fortemente recomendado)

No app: **Configurações → Conta e segurança → Ativar 2FA**. Escaneie o QR code com Google Authenticator, Authy ou 1Password e digite o código.

Com o 2FA ativo, o **próprio banco de dados** só entrega os dados para sessões que digitaram o código — quem descobrir sua senha ainda assim não vê nada.

Também em *Conta e segurança*: tempo para sair automaticamente por inatividade (padrão 60 min).

## 6. Trazer os dados que você já lançou

Se você usou o app antes (dados só no navegador):

- **No mesmo navegador:** depois de entrar, vá em *Configurações → Nuvem → Enviar para a nuvem*.
- **De outro navegador:** lá, *Configurações → Exportar backup*; no app publicado, *Configurações → Restaurar backup*.

## 7. Vendas: importar a lista de clientes

As vendas entram por planilha, sem conectar as plataformas. Uma vez por mês (ou quando quiser):

1. No painel da plataforma, exporte o relatório de vendas (CSV ou Excel .xlsx). Hotmart: Vendas → Exportar; Cakto: Vendas/Pedidos → Exportar; as demais têm opção parecida.
2. Em **Receitas → Importar lista de clientes**, escolha a plataforma — se não estiver na lista (Kiwify, Eduzz, Ticto…), escolha **Outra plataforma** e digite o nome — e envie o arquivo.
3. Confira as colunas reconhecidas (dá para ajustar) e a prévia, e clique em **Importar**.

Importar o mesmo relatório de novo não duplica, e uma venda reembolsada não volta a "aprovada". Cada produto vendido é criado automaticamente pelo nome.

A aba **Receitas** mostra a **lista de clientes** do período (data, nome e e-mail, produto, plataforma, país, valor e status), com busca e filtros por produto, plataforma, país e status, e o botão **CSV** para exportar o que está filtrado. Abaixo ficam os **lançamentos manuais** (o histórico lançado à mão e ajustes), que continuam editáveis.

**Não importe planilhas de meses que já foram lançados à mão como totais** (ex.: o histórico de jan–out/2026): as vendas seriam contadas duas vezes.

## 8. Conectar a Meta Ads

1. Em business.facebook.com → *Configurações do negócio → Usuários do sistema*, crie um usuário do sistema (Admin) e atribua suas contas de anúncio.
2. *Gerar token* → escolha um app do tipo Empresa (crie em developers.facebook.com se não tiver) → permissão **ads_read**.
3. No Gestor: **Tráfego pago → Conectar Meta Ads** (ou *Integrações → Meta Ads*), cole o token, informe as contas (`act_123…`) e crie regras **campanha → produto** (ex.: campanhas com "KETO" vão para o produto Keto).
4. **Sincronizar agora** (escolha até 12 meses para trazer o histórico). Depois disso o gasto é atualizado **de hora em hora** automaticamente.
5. A aba **Tráfego pago** cruza sozinha o gasto com as vendas das plataformas: investido, faturamento, CPA, ROAS, lucro e ROI do período, por produto e por campanha (impressões, cliques, CTR, CPC, CPM e compras do pixel). Gasto sem produto aparece em destaque: crie a regra para ele entrar no lucro do produto certo.
6. **Filtros e vendas por campanha:** no topo do painel, filtre por **produto** e por **campanha** (ou clique numa campanha na tabela). O botão **Venda manual** lança uma venda já com o produto e a campanha do filtro. Vendas lançadas com o nome da campanha entram no lucro, ROAS, CPA e ROI dela. As vendas por webhook não trazem a campanha, então contam no produto, não na campanha.

### Impostos

Em **Configurações → Impostos**:
- **Imposto do CNPJ (%)**: a alíquota do seu regime (ex.: Simples Nacional), calculada sobre a receita líquida ou o faturamento bruto.
- **Impostos da Meta sobre anúncios (%)**: no Brasil a Meta cobra impostos além do valor dos anúncios (PIS/COFINS e ISS; IOF se o cartão for internacional). Confira o percentual na sua fatura da Meta e informe aqui.

Os dois entram no lucro, no ROI, no DRE e na aba Controle de custos.

## 9. Conectar a conta Mercado Pago (banco da empresa)

1. Em **mercadopago.com.br/developers/panel/app** (logado na conta da empresa), crie uma aplicação (ex.: CADIGITAL).
2. Abra **Credenciais de produção** e copie o **Access Token** (`APP_USR-…`). Ele dá acesso à conta: cole **somente** no sistema, nunca em chat ou e-mail.
3. No sistema: **Caixa & capital → Conectar Mercado Pago**, cole o token e salve.
4. Clique em **Sincronizar agora**. O Mercado Pago leva alguns minutos para gerar o extrato; ele entra sozinho.
5. Daí em diante o extrato é atualizado **de hora em hora**: saldo, entradas, saídas (Pix e transferências enviados, saques, reembolsos, tarifas).

**O caixa começa no dia em que você conecta.** Nada anterior é buscado no Mercado Pago. A data aparece como "Caixa desde …" e pode ser mudada em **Configurar** (se mudar para mais tarde, o que veio antes sai do sistema na próxima sincronização). O saldo da conta nesse dia vem sozinho do relatório do Mercado Pago; se quiser, informe à mão no mesmo lugar.

**Caixa é separado de faturamento e lucro.** O cartão **Caixa** do Dashboard mostra o saldo real da conta Mercado Pago no fim do período — mesmo com a operação no prejuízo, ele mostra o dinheiro que você tem. Sem o banco conectado, o caixa é só aportes − retiradas − investimentos lançados em Caixa & capital.

O extrato vem do *relatório de liberações* do Mercado Pago. Na primeira sincronização, confira se o saldo bate com o app do banco; se algo vier diferente, me avise.

## 10. Documentos (comprovantes, notas, contratos)

A aba **Documentos** guarda PDFs, imagens e planilhas (até 25 MB cada) no armazenamento privado do Supabase. Só a sua conta de administrador acessa os arquivos: os links para abrir ou baixar são temporários (valem 1 minuto). Arraste os arquivos ou clique para escolher, defina categoria, data e valor (opcional) e clique em **Guardar**. Funciona só no modo nuvem.

**Nada é apagado de vez pelo sistema:**
- **Excluir** só move para a **Lixeira**, de onde dá para restaurar a qualquer momento.
- O próprio banco de dados bloqueia apagar um documento, apagar ou sobrescrever o arquivo dele e trocar o arquivo de um documento — mesmo que alguém tente direto pela API com o seu login.
- Apagar a conta de usuário é bloqueado enquanto houver documentos.

**Cópia de segurança (faça 1× por semana):** clique em **Baixar tudo (ZIP)**. Vem um ZIP com todos os arquivos (inclusive os da lixeira), organizados em pastas por categoria, e um `indice-documentos.csv` (abre no Excel) com data, nome, valor e observações. Guarde o ZIP no Google Drive ou num HD externo. O cartão fica destacado quando a última cópia tem mais de 7 dias.

## 11. Backup e longo prazo

- O plano gratuito do Supabase **não guarda backups automáticos** e pausa projetos sem uso por 7 dias. Para dados financeiros reais, recomendo o **plano Pro** (backups diários do banco). Atenção: os backups do Supabase **não incluem os arquivos** da aba Documentos — por isso o **Baixar tudo (ZIP)** semanal é importante em qualquer plano.
- Independente do plano: **Configurações → Exportar backup** (inclui as vendas individuais) e guarde o arquivo em local seguro, ao menos 1× por semana.
- Os eventos brutos dos webhooks nunca são apagados: são a prova do que cada plataforma enviou.

## 12. Atualizações do sistema

Toda melhoria publicada no GitHub atualiza o app sozinho — inclusive o app instalado (PWA) no computador ou celular, que baixa a versão nova e recarrega quando você não estiver com um formulário aberto. A versão atual aparece no rodapé de *Configurações*.

## Checklist de segurança

- [ ] Conta de administrador criada (cadastros bloqueados automaticamente)
- [ ] "Allow new users to sign up" desligado no Supabase
- [ ] 2FA ativo
- [ ] Segredos só nos Secrets do GitHub; no app, apenas a chave pública
- [ ] Segredo/token salvo em cada integração de plataforma
- [ ] Repositório: avalie torná-lo **privado** (o código não contém senhas, mas privado é mais discreto; para Pages em repositório privado é preciso GitHub Pro — alternativa gratuita: Vercel/Netlify com repositório privado, usando as mesmas variáveis `VITE_…`)
