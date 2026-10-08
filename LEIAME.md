# Controle de O.S. — front React (Vite) + backend Render
Front: `npm install && npm run dev` · publicar: `npm run build` (pasta `dist/`, funciona no GitHub Pages).
Backend: pasta `backend/` (Node, `node server.js`). No Render defina `GEMINI_API_KEY` e `FRONTEND_ORIGIN` (sites separados por vírgula).
Para outro endereço de backend: crie `.env` com `VITE_API_BASE=https://SEU-SERVICO.onrender.com`.
Tesseract: código mantido em `src/ocrLocal.js`, sem ligação com a interface. `public/admin.html` continua o painel antigo.
