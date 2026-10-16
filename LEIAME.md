# Controle de O.S. — React (Vite) + backend Node, em um só serviço no Render

## Por que o front tinha sumido
O serviço do Render rodava só `backend/server.js`, que era apenas API (a raiz `/` devolvia `{"ok":true}`),
e o Render **não instala `devDependencies`** em produção, então o `vite build` nunca gerava a pasta `dist/`.
Agora o servidor entrega o `dist/` e o build instala o Vite explicitamente.

## Render (recomendado: serviço único)
No painel do serviço `controle-de-o-s` → Settings:
| Campo | Valor |
|---|---|
| Root Directory | *(vazio — raiz do repositório)* |
| Build Command | `npm run build:render` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Environment | `GEMINI_API_KEY` (obrigatória), `NODE_VERSION=22` |
Depois: **Manual Deploy → Clear build cache & deploy**. Abra `https://SEU-SERVICO.onrender.com/`.
(Ou use o `render.yaml` como Blueprint.) `/api/health` mostra `"front": true` quando o dist foi encontrado.

## Alternativa: front no GitHub Pages
`npm run build` e publique `dist/`. No Pages o app já chama o Render sozinho; no Render mantenha
`FRONTEND_ORIGIN=https://SEU-USUARIO.github.io` (CORS). Para outro endereço de API: `VITE_API_BASE=https://...`.

## Desenvolvimento local
`npm install` · em um terminal `npm --prefix backend install && GEMINI_API_KEY=... node backend/server.js` ·
em outro `npm run dev` (o `/api` é encaminhado para `localhost:10000`; mude com `VITE_PROXY_TARGET`).

## Usar como app (celular e PC)
Abra o endereço do Render no navegador. No celular: menu do navegador → **Adicionar à tela inicial / Instalar app**
(abre em tela cheia, com ícone). No PC funciona direto no navegador (Chrome/Edge também oferecem "Instalar").
O app compartilha usuários, PINs e cargos com o painel administrativo. Sem usuários cadastrados, o uso local continua livre; após criar o primeiro administrador, passa a exigir login.

**Sem a nuvem**, os dados ficam só no navegador de cada aparelho (use *Ajustes → Baixar/Restaurar backup* para levar de um a outro).
**Com a nuvem** (abaixo), celular e PC mostram o mesmo histórico e as mesmas fotos. *Exportar Excel* fica no Histórico.
Os registros do app anterior continuam aparecendo (mesmas chaves de armazenamento).

## Nuvem: mesmo histórico no celular e no PC (Turso, grátis)
1. Crie uma conta em **turso.tech** (plano grátis, sem cartão; confira os limites atuais em turso.tech/pricing).
2. Crie um banco (ex.: `controle-os`). Copie a **Database URL** (`libsql://...`) e gere um **token** do banco.
   (Pelo terminal: `turso auth signup` · `turso db create controle-os` · `turso db show controle-os --url` · `turso db tokens create controle-os`.)
3. No Render → Environment, crie: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` e `APP_TOKEN` (invente uma frase longa, mín. 16 caracteres).
   As tabelas são criadas sozinhas. Faça o deploy.
4. Em **cada aparelho**, entre como administrador e abra **Ajustes → Outros → Painel de administração → Conexões e dados**. Informe a `APP_TOKEN` em *Chave de acesso do aplicativo*, salve e volte ao app.
   O primeiro aparelho envia todo o histórico; os outros baixam. O ícone ☁️ no topo mostra que está sincronizado.

Como funciona: tudo é gravado primeiro no aparelho (funciona sem internet) e sincroniza em segundo plano ao abrir o app, ao voltar
para ele, e depois de salvar/excluir. Se duas edições da mesma OS acontecerem, **vence a mais recente**. Exclusões também propagam.
As fotos sobem junto e são baixadas só quando você abre a OS em outro aparelho.
Segurança: sem `APP_TOKEN` a nuvem fica desligada; com ela, a IA e a nuvem só respondem a quem tem a chave
(e 20 chaves erradas seguidas bloqueiam o IP por 15 minutos). Não compartilhe a chave nem a publique no GitHub.

### Se a nuvem não sincroniza (diagnóstico Render ↔ Turso)
Abra `https://SEU-SERVICO.onrender.com/api/health`. O campo `banco` mostra o motivo, sem expor segredos:
| Resultado | Causa provável |
|---|---|
| `banco.configurado: false` | `TURSO_DATABASE_URL` vazia, sem `libsql://` ou sem `TURSO_AUTH_TOKEN` no painel do Render |
| `banco.erro` fala em token | `TURSO_AUTH_TOKEN` inválido/expirado ou de outro banco (gere um novo com `turso db tokens create`) |
| `banco.erro` fala em "não encontrou o banco" | URL errada (`turso db show NOME --url`) |
| `tokenCurto: true` | `APP_TOKEN` com menos de 16 caracteres |
| `banco.conectado: true` e `sync: true` | tudo certo no servidor; confira a chave em Ajustes → Nuvem em cada aparelho |
O servidor abre a porta sem esperar o Turso, tenta reconectar sozinho (6 vezes) e de novo a cada pedido de sincronização.

## Estrutura
- `src/App.jsx` + `src/components/*` — interface · `src/store.js` — registros, fotos, tema e backup (neste navegador)
- `src/api.js` — conexão com o backend (acorda o Render e tenta de novo) · `src/sync.js` — sincronização com a nuvem
- `backend/server.js` — API + serve `dist/` · `backend/db.js` + `backend/sync-routes.js` — banco na nuvem (Turso) · `backend/ler-os.js` — prompt, schema e limpeza da leitura da O.S. (Gemini)
- `public/admin.html` + `public/core.js` — painel antigo (manuais/peças), mantido à parte e acessível em Ajustes
- `src/ocrLocal.js` — sobra do OCR antigo, não é mais usado · `legado-python-fastapi/` — backend antigo, não usado

## Leitura da O.S. com Gemini
O front envia **só a foto** para `POST /api/ler-os`. O servidor guarda o prompt e a chave, chama a Interactions API do Gemini
com saída em JSON (schema), limpa o resultado e devolve `{campos, incertos}`. A rota genérica `/api/ai` foi removida:
antes qualquer pessoa podia usar sua chave para qualquer prompt.

Como gasta pouco token: sem "transcrição" da folha (era a maior saída), `thinking_level: low`, foto de 1600px.
Cada leitura imprime no log do Render o uso de tokens (`[ler-os] modelo uso=...`).
Se um modelo não existir ou estiver fora do ar, o servidor tenta o próximo da lista automaticamente.

| Variável | Para quê |
|---|---|
| `GEMINI_API_KEY` | chave do Google AI Studio (obrigatória) |
| `GEMINI_MODELS` | modelos em ordem de tentativa, separados por vírgula (padrão: `gemini-3.8-flash,gemini-3.5-flash`) |
| `GEMINI_THINKING` | `low` (padrão); `high` se a letra de mão errar muito; vazio = não enviar |

## Conta e administração integradas

O menu de conta fica no rodapé da lateral no desktop e no topo no celular. Login e cadastro abrem com campos vazios. O primeiro acesso permite criar o administrador; novos usuários são cadastrados por administradores, no menu ou na nova administração, acessível em **Ajustes → Outros**.

App e painel reutilizam `public/core.js`, os cadastros `os_users`/`os_cargos` e a sessão `os_sess` no sessionStorage da mesma aba. PINs existentes e seus hashes continuam compatíveis. As permissões dos cargos controlam os recursos exibidos, e novas ordens identificam quem as cadastrou. A configuração de sincronização/Turso fica somente na administração; credenciais do banco permanecem no servidor.

Este é o sistema de acesso local legado: os usuários não são sincronizados entre aparelhos, e permissões no navegador não substituem autenticação e autorização na API. A sincronização de O.S. existente continua usando o acesso do aplicativo. O cadastro local não fornece autenticação de usuários na API; o token de acesso existente protege as rotas quando configurado.

## Administração e investigação de falhas

A administração foi reconstruída em React, com visão geral, tabela de usuários, edição de acesso/PIN, cargos e permissões, conexões e backup. `public/admin.html` redireciona para `?view=admin`; o layout e os scripts do painel antigo deixaram de ser usados. Os cadastros existentes são mantidos. O login exige digitar nome e PIN, não oferece lembrar credenciais e nunca grava PINs em texto. Hashes dos cadastros legados continuam necessários para validar os usuários.

**Solução de problemas** permite descrever equipamento, código e sintomas. O backend envia o pedido ao Gemini `generateContent` com a ferramenta `google_search`, e devolve a orientação e as fontes retornadas pelo provedor. Respostas sem evidência de pesquisa e sem fontes HTTPS são recusadas; não há simulação de busca em produção. A permissão usada é `perguntar_ia`. A rota `POST /api/diagnostico` reutiliza o controle de acesso por `APP_TOKEN`, valida o corpo e limita consultas a 10 por minuto por IP.

Configure `GEMINI_API_KEY` somente no servidor. `DIAGNOSTICO_MODEL` é opcional (padrão `gemini-2.5-flash`) e deve selecionar um modelo disponível na conta com suporte a Google Search. A conta precisa permitir grounding/pesquisa e ter cota disponível; cobrança segue o provedor. Não reutilizamos uma resposta sem fontes como diagnóstico confirmado. A orientação é auxiliar: confirme o manual e os procedimentos de segurança antes de intervir.

Validação local: `node --test backend/diagnostico.test.js` e `npm run build`. Os testes de integração do provedor usam respostas simuladas para verificar contratos, fontes e erros; eles não comprovam acesso real à internet pelo provedor. Sem credencial configurada, a rota responde `503 AI_NOT_CONFIGURED`.
