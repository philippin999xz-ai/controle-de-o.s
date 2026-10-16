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
| Environment | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_NAME`, `ADMIN_PIN`, `NODE_VERSION=22`; `GEMINI_API_KEY` para IA |
Depois: **Manual Deploy → Clear build cache & deploy**. Abra `https://SEU-SERVICO.onrender.com/`.
(Ou use o `render.yaml` como Blueprint.) `/api/health` mostra `"front": true` quando o dist foi encontrado.

## Alternativa: front no GitHub Pages
`npm run build` e publique `dist/`. No Pages o app já chama o Render sozinho; no Render mantenha
`FRONTEND_ORIGIN=https://SEU-USUARIO.github.io` (CORS). Para outro endereço de API: `VITE_API_BASE=https://...`.

## Desenvolvimento local
Instale com `npm ci --include=dev` e `npm --prefix backend ci`. Configure `TURSO_DATABASE_URL` (é permitido `file:/tmp/controle-os.db` para desenvolvimento), `ADMIN_NAME` e `ADMIN_PIN` no processo do backend. Inicie `npm start` e, em outro terminal, `npm run dev`. O proxy aponta para `localhost:10000`; `VITE_PROXY_TARGET` permite outro destino. Os `.env.example` documentam os nomes; o servidor lê variáveis do processo, não carrega arquivos `.env` automaticamente.

## Dados e contas centrais no Render / Turso
1. No Render → Environment, configure `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` do mesmo banco Turso.
2. Para um banco sem usuários, defina `ADMIN_NAME` e `ADMIN_PIN` (4 a 8 números) e faça o deploy. O servidor cria o primeiro administrador uma única vez. Alterar essas variáveis depois não redefine contas existentes; use a administração para redefinir PINs.
3. Entre com esse usuário em qualquer aparelho. Cadastre a equipe em **Administração → Usuários**. O mesmo nome, PIN e cargo funcionam no desktop e no celular. Não se configura chave em cada aparelho; `APP_TOKEN` deixou de autenticar o navegador.
4. As tabelas `usuarios`, `cargos` e `sessoes` são criadas automaticamente ao lado de `os` e `fotos`. As ordens e fotos existentes são preservadas. As chaves do Turso e da IA nunca são enviadas ao app.

A autorização é feita no backend em toda requisição. PINs usam PBKDF2 com sal; sessões opacas duram 8 horas, ficam no sessionStorage da aba e são guardadas no banco apenas como hash. Logout revoga a sessão no servidor; redefinir o PIN revoga as sessões do usuário em todos os aparelhos. Não há cadastro público de administradores. O login é limitado por IP e por conta. Cargos são verificados no servidor, incluindo os limites de histórico, edição, exclusão e uso de IA.

### Sincronização automática
Após o login, o app busca as ordens autorizadas. Salvar/excluir envia a fila automaticamente. Enquanto a página está visível, o app consulta o servidor a cada 15 segundos, ao recuperar a internet e ao voltar à página. Não depende de botão de sincronização. A cópia local é isolada por conta e serve como cache/fila temporária offline; usuários e permissões têm o Turso como fonte de verdade. Um aparelho fechado ou sem internet recebe alterações ao reconectar/abrir. Não é um serviço de sincronização em segundo plano com o navegador fechado.

O indicador só mostra sincronizado após concluir os pedidos da API. Em **Administração → Conexões e dados**, confira o erro concreto e as quantidades pendentes. Listagens grandes são paginadas sem avançar o cursor antes de salvar os resultados. Atualizações feitas durante um envio continuam na fila. Conflitos de O.S. seguem a versão mais recente, e fotos são armazenadas no banco remoto.

### Migração dos dados antigos
No aparelho onde estavam os registros antigos, entre como administrador central. A primeira entrada copia as ordens e fotos locais para a fila da conta, sem apagar a origem. Para usuários, use **Administração → Conexões e dados → Migrar usuários antigos deste navegador**. Somente um administrador autenticado no servidor pode realizar a importação. Nomes já existentes são preservados; os outros usuários mantêm IDs e PINs compatíveis. Hashes legados são atualizados após um login válido. Cargos personalizados ausentes também são importados; cargos centrais existentes não são sobrescritos.

Backups centrais são exportados pela API administrativa. Importações são autenticadas, preservam usuários já existentes e colocam as ordens na fila de envio. Fotos não são incluídas no JSON de backup.

### Como verificar que o envio é real
Cadastre uma O.S. com número exclusivo e aguarde sincronizar. No editor SQL do **mesmo banco** configurado no Render, execute:
```sql
SELECT id, dados, atualizado_em FROM os
WHERE json_extract(dados, '$.numero_os') = 'TESTE-TURSO-001' AND apagado = 0;
```
A existência das tabelas ou `banco.conectado: true` confirma conectividade/esquema, mas não prova que uma ordem específica chegou. A linha no banco remoto é a confirmação dessa gravação. Faça login em outro navegador para verificar a leitura e a propagação automática.

`/api/health` não expõe segredos e mostra configuração/conexão do banco. Se o banco estiver indisponível, login e sincronização informam o erro em vez de liberar um acesso local simulado. Não apague o cache nem os registros enquanto houver envios pendentes.

## Estrutura
- `src/App.jsx` + `src/components/*` — interface · `src/store.js` — registros, fotos, tema e backup (neste navegador)
- `src/api.js` — conexão com o backend (acorda o Render e tenta de novo) · `src/sync.js` — sincronização com a nuvem
- `backend/server.js` — API + serve `dist/` · `backend/db.js` + `backend/sync-routes.js` — banco na nuvem (Turso) · `backend/ler-os.js` — prompt, schema e limpeza da leitura da O.S. (Gemini)
- `backend/accounts.js` — usuários, cargos, sessões e migração no servidor; `src/auth.js` — login central
- `public/admin.html` — redireciona para a administração React; `public/core.js` permanece apenas para leitura/migração de cadastros legados
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

## Administração e investigação de falhas

A administração foi reconstruída em React, com visão geral, tabela de usuários, edição de acesso/PIN, cargos e permissões, conexões e backup. `public/admin.html` redireciona para `?view=admin`; o layout e os scripts do painel antigo deixaram de ser usados. Os cadastros existentes são mantidos. O login exige digitar nome e PIN, não oferece lembrar credenciais e nunca grava PINs em texto. Hashes dos cadastros legados continuam necessários para validar os usuários.

**Solução de problemas** permite descrever equipamento, código e sintomas. O backend envia o pedido ao Gemini `generateContent` com a ferramenta `google_search`, e devolve a orientação e as fontes retornadas pelo provedor. Respostas sem evidência de pesquisa e sem fontes HTTPS são recusadas; não há simulação de busca em produção. A permissão usada é `perguntar_ia`. A rota `POST /api/diagnostico` exige sessão central e a permissão `perguntar_ia`, valida o corpo e limita consultas a 10 por minuto por IP.

Configure `GEMINI_API_KEY` somente no servidor. `DIAGNOSTICO_MODEL` é opcional (padrão `gemini-2.5-flash`) e deve selecionar um modelo disponível na conta com suporte a Google Search. A conta precisa permitir grounding/pesquisa e ter cota disponível; cobrança segue o provedor. Não reutilizamos uma resposta sem fontes como diagnóstico confirmado. A orientação é auxiliar: confirme o manual e os procedimentos de segurança antes de intervir.

Validação local: `node --test backend/*.test.js` e `npm run build`. `accounts.integration.test.js` usa banco SQLite real e dois processos de servidor para testar identidade compartilhada, permissões, persistência, paginação e revogação de sessões. Isso valida o código, mas não substitui o teste com as credenciais do Turso no Render. Os testes de integração do provedor usam respostas simuladas para verificar contratos, fontes e erros; eles não comprovam acesso real à internet pelo provedor. Sem credencial configurada, a rota responde `503 AI_NOT_CONFIGURED`.
