# Backend de referência — proxy seguro do Gemini

Este backend elimina a chave Gemini do navegador. O frontend chama `/api/ai` e a chave é lida somente de `GEMINI_API_KEY` no ambiente do servidor.

**Importante:** este pacote é um backend de referência porque o código atual do backend/Render não estava entre os arquivos fornecidos. Ele não substitui silenciosamente o backend existente.

Para produção, o mesmo princípio deve ser aplicado às rotas de OS, usuários, cargos, manuais e fotos: autenticação no servidor, autorização por permissão no servidor e banco centralizado.
