import { createAiGateway, AiUnavailable } from "./ai-providers.js";
// Servidor único: API de IA (/api/*) + front React compilado (../dist).
// Se ../dist não existir, responde só a API (modo "backend separado").
import express from "express";
import { accounts } from "./accounts.js";
import { diagnosticRouter } from "./diagnostico.js";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  conectarBanco,
  garantirBanco,
  obterBanco,
  estadoBanco,
  motivoErro,
} from "./db.js";
import { rotasSync } from "./sync-routes.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(
  process.env.DIST_DIR || path.join(AQUI, "..", "dist"),
);
const TEM_FRONT = existsSync(path.join(DIST, "index.html"));

const PORT = Number(process.env.PORT || 10000);
const aiGateway = createAiGateway();
const SYNC_OK = () => Boolean(obterBanco());
const identity = accounts({
  db: obterBanco,
  ready: garantirBanco,
  adminName: process.env.ADMIN_NAME || "",
  adminPin: process.env.ADMIN_PIN || "",
});
conectarBanco().then(() => {
  if (estadoBanco().ok)
    identity
      .initialize()
      .catch(() =>
        console.error(
          "[contas] Não foi possível preparar os cadastros centrais.",
        ),
      );
});
const exigirToken = [identity.database, identity.session];
const norm = (x) => x.trim().replace(/\/$/, "");
const ORIGENS = [
  ...(
    process.env.FRONTEND_ORIGIN || "https://philippin999xz-ai.github.io"
  ).split(","),
  process.env.RENDER_EXTERNAL_URL || "",
  "http://localhost:5173",
  "http://localhost:4173",
]
  .map(norm)
  .filter(Boolean);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
);

// Mesma origem (front servido por este servidor) não depende de CORS; isto vale para o GitHub Pages.
app.use(
  "/api",
  cors({
    origin: (origin, cb) => cb(null, !origin || ORIGENS.includes(norm(origin))),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  }),
);

app.use(express.json({ limit: "12mb" }));

const msgLimite = {
  error: {
    code: "RATE_LIMITED",
    message: "Muitas requisições. Aguarde um minuto.",
  },
};
// IA: cada leitura custa dinheiro/cota.
app.use(
  "/api/ler-os",
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: msgLimite,
  }),
);
// Pesquisa na IA tem limite próprio; leituras do histórico não consomem esse limite.
app.use(
  "/api/diagnostico",
  rateLimit({
    windowMs: 60_000,
    limit: 10,
    skip: (req) => req.method !== "POST",
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: msgLimite,
  }),
);
app.use("/api/diagnostico/historico", rateLimit({
  windowMs: 60_000, limit: 120,
  standardHeaders: "draft-7", legacyHeaders: false, message: msgLimite,
}));
// Sincronização: muitas chamadas pequenas (fotos do histórico).
app.use(
  "/api/sync",
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: msgLimite,
  }),
);
// Contra tentativa de adivinhar a chave: conta só as respostas 401.
const limiteChave = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Muitas tentativas com chave inválida. Aguarde 15 minutos.",
    },
  },
});

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const b = estadoBanco();
  res.json({
    ok: true,
    service: "controle-os",
    ai: aiGateway.configured("vision"),
    research: aiGateway.configured("search"),
    providers: aiGateway.status(),
    provider: "automatic",
    front: TEM_FRONT,
    auth: true,
    central: true,
    sync: SYNC_OK(),
    // Diagnóstico Render <-> Turso (sem segredos): se sync=false, o motivo aparece aqui.
    banco: {
      configurado: b.configurado,
      conectado: b.ok,
      tentativas: b.tentativas,
      erro: b.ok ? null : b.erro,
    },
  });
});

const FotoSchema = z
  .object({
    image: z
      .string()
      .min(100)
      .max(10_000_000)
      .regex(/^[A-Za-z0-9+/=]+$/),
    mime: z
      .enum(["image/jpeg", "image/png", "image/webp"])
      .default("image/jpeg"),
  })
  .strict();

app.post(
  "/api/ler-os", limiteChave, exigirToken, identity.need("usar_ia"),
  async (req, res, next) => {
    const parsed = FotoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Foto inválida." } });
    try {
      res.set("Cache-Control", "no-store").json(await aiGateway.vision(parsed.data));
    } catch (error) {
      if (!(error instanceof AiUnavailable)) return next(error);
      if (error.status === 429) res.set("Retry-After", String(error.retryAfter));
      res.status(error.status).json({ error: { code: error.code, message: error.message, retryAfter: error.retryAfter } });
    }
  },
);

app.use(
  "/api/diagnostico",
  (req, res, next) => req.method === "POST" ? limiteChave(req, res, next) : next(),
  exigirToken,
  identity.need("perguntar_ia"),
  diagnosticRouter({
    db: obterBanco,
    apiKey: aiGateway.configured("search") ? "configured-on-server" : "",
    research: aiGateway.research,
  }),
);

app.use(
  ["/api/auth/login", "/api/auth/setup"],
  limiteChave,
  rateLimit({
    windowMs: 900000,
    limit: 30,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: { message: "Muitas tentativas de acesso. Aguarde 15 minutos." },
    },
  }),
);
app.use("/api/auth", identity.router);
app.use(
  "/api/sync",
  exigirToken,
  rotasSync(obterBanco),
  (err, _req, res, next) => {
    if (err?.type) return next(err);
    res.status(502).json({
      error: {
        code: "DB_ERROR",
        message:
          "Não foi possível sincronizar com o banco central. Tente novamente.",
      },
    });
  },
);

app.use("/api", (_req, res) =>
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Rota não encontrada." } }),
);

if (TEM_FRONT) {
  // Arquivos com hash (assets/) podem ser guardados para sempre; o resto sempre revalida.
  app.use(
    express.static(DIST, {
      index: false,
      setHeaders(res, file) {
        res.setHeader(
          "Cache-Control",
          file.includes(`${path.sep}assets${path.sep}`)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    }),
  );
  // Qualquer outra rota GET devolve o app; pedidos de arquivo inexistente (ex.: /x.js) dão 404 de verdade.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (path.extname(req.path))
      return res.status(404).type("text").send("Não encontrado");
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(DIST, "index.html"), (e) => e && next(e));
  });
} else {
  app.get("/", (_req, res) =>
    res.json({
      ok: true,
      aviso:
        "Front não encontrado (pasta dist ausente). Rode 'npm run build' antes de iniciar, ou use o Build Command do render.yaml.",
    }),
  );
}

app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: {
        code: "TOO_LARGE",
        message: "Foto grande demais. Tente outra foto.",
      },
    });
  }
  if (err?.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ error: { code: "BAD_JSON", message: "JSON inválido." } });
  }
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return res.status(504).json({
      error: {
        code: "AI_TIMEOUT",
        message: "O provedor de IA demorou demais.",
      },
    });
  }
  console.error("[api]", err?.message || err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Erro interno do servidor." },
  });
});

app.listen(PORT, () => {
  console.log(
    `controle-os na porta ${PORT} · front: ${TEM_FRONT ? DIST : "NÃO ENCONTRADO"} · IA: ${aiGateway.status().map((p) => p.nome).join(" > ") || "sem chave"} · nuvem: ${estadoBanco().configurado ? "centralizada" : "desligada"}`,
  );
});
