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
App de uso pessoal: **sem login, PIN ou cargos**; abre direto em Nova OS.

**Sem a nuvem**, os dados ficam só no navegador de cada aparelho (use *Ajustes → Baixar/Restaurar backup* para levar de um a outro).
**Com a nuvem** (abaixo), celular e PC mostram o mesmo histórico e as mesmas fotos. *Exportar Excel* fica no Histórico.
Os registros do app anterior continuam aparecendo (mesmas chaves de armazenamento).

## Nuvem: mesmo histórico no celular e no PC (Turso, grátis)
1. Crie uma conta em **turso.tech** (plano grátis, sem cartão; confira os limites atuais em turso.tech/pricing).
2. Crie um banco (ex.: `controle-os`). Copie a **Database URL** (`libsql://...`) e gere um **token** do banco.
   (Pelo terminal: `turso auth signup` · `turso db create controle-os` · `turso db show controle-os --url` · `turso db tokens create controle-os`.)
3. No Render → Environment, crie: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` e `APP_TOKEN` (invente uma frase longa, mín. 16 caracteres).
   As tabelas são criadas sozinhas. Faça o deploy.
4. Em **cada aparelho**: abra o app → **Ajustes → Nuvem** → cole a `APP_TOKEN` → *Salvar chave e sincronizar*.
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
