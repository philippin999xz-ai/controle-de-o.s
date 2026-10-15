// Servidor único: API de IA (/api/*) + front React compilado (../dist).
// Se ../dist não existir, responde só a API (modo "backend separado").
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { PROMPT_OS, SCHEMA_OS, normalizarResultado } from "./ler-os.js";
import { abrirBanco } from "./db.js";
import { rotasSync } from "./sync-routes.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.DIST_DIR || path.join(AQUI, "..", "dist"));
const TEM_FRONT = existsSync(path.join(DIST, "index.html"));

const PORT = Number(process.env.PORT || 10000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
// Tenta na ordem; se um modelo não existir/estiver fora do ar, usa o próximo. (GEMINI_MODELS="a,b")
const MODELOS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "gemini-3.8-flash,gemini-3.5-flash")
  .split(",").map((x) => x.trim()).filter(Boolean);
const THINKING = (process.env.GEMINI_THINKING || "low").trim(); // pouco raciocínio = pouco token; vazio = não enviar
const APP_TOKEN = (process.env.APP_TOKEN || "").trim();   // chave de acesso do app (você digita uma vez em cada aparelho)
if (APP_TOKEN && APP_TOKEN.length < 16) console.warn("[aviso] APP_TOKEN curto: use pelo menos 16 caracteres.");
let db = null;
try { db = await abrirBanco(); } catch (e) { console.error("[banco] não consegui conectar:", e?.message || e); }
const SYNC_OK = Boolean(db && APP_TOKEN.length >= 16);
if (db && !SYNC_OK) console.warn("[aviso] Banco configurado, mas falta APP_TOKEN (mín. 16 caracteres): sincronização desligada.");
const hash = (x) => createHash("sha256").update(String(x)).digest();
function tokenOk(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  return Boolean(m) && timingSafeEqual(hash(m[1].trim()), hash(APP_TOKEN));
}
// Com APP_TOKEN definido, a IA e a sincronização só respondem a quem tem a chave.
const exigirToken = (req, res, next) => (!APP_TOKEN || tokenOk(req))
  ? next()
  : res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Chave de acesso ausente ou inválida. Informe em Ajustes." } });
const norm = (x) => x.trim().replace(/\/$/, "");
const ORIGENS = [
  ...(process.env.FRONTEND_ORIGIN || "https://philippin999xz-ai.github.io").split(","),
  process.env.RENDER_EXTERNAL_URL || "",
  "http://localhost:5173",
  "http://localhost:4173",
].map(norm).filter(Boolean);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Mesma origem (front servido por este servidor) não depende de CORS; isto vale para o GitHub Pages.
app.use("/api", cors({
  origin: (origin, cb) => cb(null, !origin || ORIGENS.includes(norm(origin))),
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
}));

app.use(express.json({ limit: "12mb" }));

const msgLimite = { error: { code: "RATE_LIMITED", message: "Muitas requisições. Aguarde um minuto." } };
// IA: cada leitura custa dinheiro/cota.
app.use("/api/ler-os", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: msgLimite }));
// Sincronização: muitas chamadas pequenas (fotos do histórico).
app.use("/api/sync", rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false, message: msgLimite }));
// Contra tentativa de adivinhar a chave: conta só as respostas 401.
const limiteChave = rateLimit({
  windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Muitas tentativas com chave inválida. Aguarde 15 minutos." } },
});

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "controle-os", ai: Boolean(GEMINI_API_KEY), models: MODELOS, front: TEM_FRONT, auth: Boolean(APP_TOKEN), sync: SYNC_OK });
});

const FotoSchema = z.object({
  image: z.string().min(100).max(10_000_000).regex(/^[A-Za-z0-9+/=]+$/),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
}).strict();

async function chamarGemini(model, foto, comThinking) {
  const corpo = {
    model,
    input: [
      { type: "text", text: PROMPT_OS },
      { type: "image", data: foto.image, mime_type: foto.mime },
    ],
    response_format: { type: "text", mime_type: "application/json", schema: SCHEMA_OS },
  };
  if (comThinking && THINKING) corpo.generation_config = { thinking_level: THINKING };
  const r = await fetch(`${GEMINI_URL}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(90_000),
  });
  const bruto = await r.text();
  let json; try { json = JSON.parse(bruto); } catch { json = {}; }
  return { r, json, bruto };
}

function textoDaResposta(j) {
  if (typeof j?.output_text === "string" && j.output_text.trim()) return j.output_text;
  const out = [];
  for (const s of j?.steps || []) if (s.type === "model_output") for (const c of s.content || []) if (typeof c?.text === "string") out.push(c.text);
  return out.join("\n").trim();
}

app.post("/api/ler-os", limiteChave, exigirToken, async (req, res, next) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({ error: { code: "AI_NOT_CONFIGURED", message: "IA não configurada no servidor (GEMINI_API_KEY)." } });
    }
    const v = FotoSchema.safeParse(req.body);
    if (!v.success) return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Foto inválida." } });

    let ultimo = null;
    for (const model of MODELOS) {
      let t = await chamarGemini(model, v.data, true);
      // Modelo sem suporte a thinking_level: repete sem ele.
      if (t.r.status === 400 && THINKING && /thinking|generation_config/i.test(t.bruto)) t = await chamarGemini(model, v.data, false);

      if (t.r.ok) {
        const texto = textoDaResposta(t.json);
        let dados; try { dados = JSON.parse(texto.replace(/```json|```/gi, "").trim()); } catch { dados = null; }
        if (!dados) { ultimo = { status: 502, code: "AI_BAD_OUTPUT", message: "A IA respondeu fora do formato." }; continue; }
        if (t.json.usage) console.log(`[ler-os] ${model} uso=${JSON.stringify(t.json.usage)}`);
        return res.json(normalizarResultado(dados));
      }
      const msg = t.json?.error?.message || "Falha no provedor de IA.";
      console.error("[gemini]", model, t.r.status, msg.slice(0, 200));
      if (t.r.status === 401 || t.r.status === 403) {
        return res.status(502).json({ error: { code: "AI_PROVIDER_ERROR", message: "Chave do Gemini inválida ou sem permissão no servidor." } });
      }
      ultimo = {
        status: t.r.status >= 500 ? 502 : t.r.status, code: "AI_PROVIDER_ERROR",
        message: t.r.status === 429 ? "Limite de uso do Gemini atingido. Tente em instantes." : msg,
      };
      // 400 sem relação com modelo = foto/pedido ruim: não adianta trocar de modelo.
      if (t.r.status === 400 && !/model/i.test(msg)) break;
    }
    return res.status(ultimo?.status || 502).json({ error: { code: ultimo?.code || "AI_PROVIDER_ERROR", message: ultimo?.message || "Falha no provedor de IA." } });
  } catch (err) {
    return next(err);
  }
});

app.use("/api/sync", limiteChave, (req, res, next) => {
  if (!SYNC_OK) return res.status(503).json({ error: { code: "SYNC_NOT_CONFIGURED", message: "Sincronização não configurada no servidor (TURSO_DATABASE_URL e APP_TOKEN)." } });
  next();
}, exigirToken, rotasSync(db));

app.use("/api", (_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } }));

if (TEM_FRONT) {
  // Arquivos com hash (assets/) podem ser guardados para sempre; o resto sempre revalida.
  app.use(express.static(DIST, {
    index: false,
    setHeaders(res, file) {
      res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache");
    },
  }));
  // Qualquer outra rota GET devolve o app; pedidos de arquivo inexistente (ex.: /x.js) dão 404 de verdade.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (path.extname(req.path)) return res.status(404).type("text").send("Não encontrado");
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(DIST, "index.html"), (e) => e && next(e));
  });
} else {
  app.get("/", (_req, res) => res.json({
    ok: true,
    aviso: "Front não encontrado (pasta dist ausente). Rode 'npm run build' antes de iniciar, ou use o Build Command do render.yaml.",
  }));
}

app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "TOO_LARGE", message: "Foto grande demais. Tente outra foto." } });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "JSON inválido." } });
  }
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return res.status(504).json({ error: { code: "AI_TIMEOUT", message: "O provedor de IA demorou demais." } });
  }
  console.error("[api]", err?.message || err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." } });
});

app.listen(PORT, () => {
  console.log(`controle-os na porta ${PORT} · front: ${TEM_FRONT ? DIST : "NÃO ENCONTRADO"} · IA: ${GEMINI_API_KEY ? MODELOS.join(" > ") : "sem chave"} · nuvem: ${SYNC_OK ? "ligada" : "desligada"}`);
});
