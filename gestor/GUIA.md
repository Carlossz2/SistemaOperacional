# Guia de configuração — Gestor DR (Supabase + GitHub)

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
   - **Chave pública:** *Project Settings → API Keys* → aba *Legacy API keys* → `anon` `public`.
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

- **Gestor DR — Backend (Supabase):** testa tudo, cria as tabelas, regras de segurança e funções no seu projeto.
- **Gestor DR — Publicar no GitHub Pages:** publica o app em `https://<usuario>.github.io/<repositorio>/`.

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

## 7. Conectar as plataformas de venda

Em **Integrações → Conexões**, escolha a plataforma e clique em **Adicionar**. Para cada uma:

1. Copie a **URL do webhook** gerada.
2. No painel da plataforma, cadastre um webhook com essa URL e ative os eventos indicados no cartão.
3. Copie o segredo/token que a plataforma mostra e salve no campo do cartão (ele não é exibido de volta).
4. Envie um **evento de teste** pela plataforma e confira em **Integrações → Eventos recebidos**.

| Plataforma | Onde configurar | Segredo |
|---|---|---|
| Hotmart | Ferramentas → Webhook (API e Notificações) | Hottok (enviado no cabeçalho) |
| Cakto | Integrações → Webhooks | campo *Secret* |
| Lastlink | Integrações → Webhook | token de validação |
| GGCheckout | Integrações → Webhooks | campo *Secret* |
| PerfectPay | Ferramentas → Postback/Webhook | token do postback |
| Outra | — | use **"Outra plataforma"** e informe onde ficam os campos no JSON |

**Taxas:** Hotmart e Cakto informam as taxas no webhook. Para as demais, preencha **"Taxa %"** no cartão (ex.: 9,9) para o lucro sair correto; vendas com taxa estimada aparecem com `*`.

**Primeira venda real de cada plataforma:** confira em *Eventos recebidos* se valor, produto e taxa saíram certos. O conteúdo recebido fica guardado (ícone 👁); se algo vier diferente, o adaptador é ajustado e você clica em **Reprocessar** — nada se perde.

**Produtos:** cada produto vendido é criado automaticamente. Para juntar o mesmo produto de plataformas diferentes, use **Integrações → Produtos das plataformas**.

## 8. Conectar a Meta Ads

1. Em business.facebook.com → *Configurações do negócio → Usuários do sistema*, crie um usuário do sistema (Admin) e atribua suas contas de anúncio.
2. *Gerar token* → escolha um app do tipo Empresa (crie em developers.facebook.com se não tiver) → permissão **ads_read**.
3. No Gestor: **Integrações → Meta Ads → Conectar**, cole o token, informe as contas (`act_123…`) e crie regras **campanha → produto** (ex.: campanhas com "KETO" vão para o produto Keto).
4. **Sincronizar agora** (escolha até 12 meses para trazer o histórico). Depois disso o gasto é atualizado **de hora em hora** automaticamente.

## 9. Backup e longo prazo

- O plano gratuito do Supabase **não guarda backups automáticos** e pausa projetos sem uso por 7 dias. Para dados financeiros reais, recomendo o **plano Pro** (backups diários).
- Independente do plano: **Configurações → Exportar backup** (inclui as vendas individuais) e guarde o arquivo em local seguro, ao menos 1× por semana.
- Os eventos brutos dos webhooks nunca são apagados: são a prova do que cada plataforma enviou.

## 10. Atualizações do sistema

Toda melhoria publicada no GitHub atualiza o app sozinho — inclusive o app instalado (PWA) no computador ou celular, que baixa a versão nova e recarrega quando você não estiver com um formulário aberto. A versão atual aparece no rodapé de *Configurações*.

## Checklist de segurança

- [ ] Conta de administrador criada (cadastros bloqueados automaticamente)
- [ ] "Allow new users to sign up" desligado no Supabase
- [ ] 2FA ativo
- [ ] Segredos só nos Secrets do GitHub; no app, apenas a chave pública
- [ ] Segredo/token salvo em cada integração de plataforma
- [ ] Repositório: avalie torná-lo **privado** (o código não contém senhas, mas privado é mais discreto; para Pages em repositório privado é preciso GitHub Pro — alternativa gratuita: Vercel/Netlify com repositório privado, usando as mesmas variáveis `VITE_…`)
