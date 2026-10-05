# Gestão Inteligente de Ordens de Serviço

App web (celular e PC): foto da OS → leitura por IA → conferência → histórico → exportar Excel → consulta de compatibilidade.

## Como publicar (GitHub Pages)
1. Crie um repositório no GitHub (pode ser **privado**).
2. Envie `index.html` e este `README.md`.
3. Settings → Pages → Branch `main` / pasta `/ (root)` → Save.
4. Abra a URL gerada no celular. (Pages em repositório privado exige plano pago; no plano gratuito o repositório precisa ser público. A chave da API **não** fica no código, então isso é seguro.)

## Chave da API (gratuita)
1. Gere uma chave em https://aistudio.google.com/apikey
2. No app: aba **Nova OS** → **🔑 Chave da API** e cole. Ela fica só no navegador do aparelho.

## Dados
- Registros em `localStorage` e fotos em IndexedDB, **por aparelho**. Exporte o Excel para backup.
- Ao processar foto ou perguntar compatibilidade, o conteúdo é enviado à API do Google.

## Próximos passos
Banco compartilhado (Supabase/Firebase), tabelas de equipamentos/motores/peças, comparador por regras antes da IA.
