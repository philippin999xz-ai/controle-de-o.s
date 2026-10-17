// Servidor único: API de IA (/api/*) + front React compilado (../dist).
// Se ../dist não existir, responde só a API (modo "backend separado").
import express from "express";
import { accounts } from "./accounts.js";
import { diagnosticRouter } from "./diagnostico.js";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PROMPT_OS, SCHEMA_OS, DICA_JSON, normalizarResultado } from "./ler-os.js";
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
const GROQ_API_KEY = (process.env.GROQ_API_KEY || "").trim();
const GROQ_URL = (
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"
).replace(/\/$/, "");
// Modelos com visão, na ordem de tentativa; se um não existir/estiver fora do ar, usa o próximo. (GROQ_MODELS="a,b")
const MODELOS = (
  process.env.GROQ_MODELS ||
  process.env.GROQ_MODEL ||
  "qwen/qwen3.8-27b"
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
// "none" = modo direto (sem raciocínio): mais rápido e gasta menos cota. "default"/"low"/"medium"/"high" ligam o raciocínio; vazio = não enviar.
const REASONING = (process.env.GROQ_REASONING ?? "none").trim();
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
// Sincronização: muitas chamadas pequenas (fotos do histórico).
app.use(
  "/api/diagnostico",
  rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: msgLimite,
  }),
);
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
    ai: Boolean(GROQ_API_KEY),
    provider: "groq",
    models: MODELOS,
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

// Chamada à API do Groq (compatível com OpenAI). Variantes, da mais precisa para a mais simples,
// para o caso de o modelo não aceitar json_schema ou reasoning_effort: só avançamos em erro 400 desses parâmetros.
const VARIANTES = [
  { schema: true, razao: true },
  { schema: true, razao: false },
  { schema: false, razao: false },
];

async function chamarGroq(model, foto, v) {
  const corpo = {
    model,
    messages: [
      {
        role: "system",
        content: PROMPT_OS + (v.schema ? "" : "\n\n" + DICA_JSON),
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Leia esta O.S. e responda somente com o JSON." },
          {
            type: "image_url",
            image_url: { url: `data:${foto.mime};base64,${foto.image}` },
          },
        ],
      },
    ],
    temperature: 0,
    max_completion_tokens: 1500,
    response_format: v.schema
      ? {
          type: "json_schema",
          json_schema: { name: "leitura_os", strict: false, schema: SCHEMA_OS },
        }
      : { type: "json_object" },
  };
  if (v.razao && REASONING) corpo.reasoning_effort = REASONING;
  const r = await fetch(`${GROQ_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(60_000),
  });
  const bruto = await r.text();
  let json;
  try {
    json = JSON.parse(bruto);
  } catch {
    json = {};
  }
  return { r, json, bruto };
}

async function chamarComVariantes(model, foto) {
  let t;
  for (const v of VARIANTES) {
    if (v.razao && !REASONING) continue;
    t = await chamarGroq(model, foto, v);
    const msg = t.json?.error?.message || "";
    // 400 por parâmetro não suportado: tenta a próxima variante. Qualquer outra resposta encerra.
    if (
      t.r.status === 400 &&
      /reasoning|response_format|json_schema|schema|strict/i.test(msg)
    )
      continue;
    return t;
  }
  return t;
}

app.post(
  "/api/ler-os",
  limiteChave,
  exigirToken,
  identity.need("usar_ia"),
  async (req, res, next) => {
    try {
      if (!GROQ_API_KEY) {
        return res.status(503).json({
          error: {
            code: "AI_NOT_CONFIGURED",
            message: "IA não configurada no servidor (GROQ_API_KEY).",
          },
        });
      }
      const v = FotoSchema.safeParse(req.body);
      if (!v.success)
        return res.status(400).json({
          error: { code: "INVALID_INPUT", message: "Foto inválida." },
        });

      let ultimo = null;
      for (const model of MODELOS) {
        const t = await chamarComVariantes(model, v.data);

        if (t.r.ok) {
          const texto = String(t.json?.choices?.[0]?.message?.content || "");
          let dados;
          try {
            dados = JSON.parse(
              texto
                .replace(/<think>[\s\S]*?<\/think>/gi, "")
                .replace(/```json|```/gi, "")
                .trim(),
            );
          } catch {
            dados = null;
          }
          if (!dados) {
            ultimo = {
              status: 502,
              code: "AI_BAD_OUTPUT",
              message: "A IA respondeu fora do formato.",
            };
            continue;
          }
          if (t.json.usage)
            console.log(
              `[ler-os] ${model} uso=${JSON.stringify(t.json.usage)}`,
            );
          return res.json(normalizarResultado(dados));
        }
        const msg = t.json?.error?.message || "Falha no provedor de IA.";
        console.error("[groq]", model, t.r.status, msg.slice(0, 200));
        if (t.r.status === 401 || t.r.status === 403) {
          return res.status(502).json({
            error: {
              code: "AI_PROVIDER_ERROR",
              message:
                "Chave do Groq inválida ou sem permissão (confira GROQ_API_KEY no Render).",
            },
          });
        }
        ultimo = {
          status: t.r.status >= 500 ? 502 : t.r.status,
          code: "AI_PROVIDER_ERROR",
          message:
            t.r.status === 429
              ? "Limite gratuito do Groq atingido. Tente em instantes."
              : msg,
        };
        // 400 sem relação com modelo = foto/pedido ruim: não adianta trocar de modelo.
        if (t.r.status === 400 && !/model/i.test(msg)) break;
      }
      return res.status(ultimo?.status || 502).json({
        error: {
          code: ultimo?.code || "AI_PROVIDER_ERROR",
          message: ultimo?.message || "Falha no provedor de IA.",
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

app.use(
  "/api/diagnostico",
  limiteChave,
  exigirToken,
  identity.need("perguntar_ia"),
  diagnosticRouter({
    db: obterBanco,
    apiKey: GROQ_API_KEY,
    baseURL: GROQ_URL,
    model: process.env.DIAGNOSTICO_MODEL || "openai/gpt-oss-120b",
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
    `controle-os na porta ${PORT} · front: ${TEM_FRONT ? DIST : "NÃO ENCONTRADO"} · IA: ${GROQ_API_KEY ? "Groq " + MODELOS.join(" > ") : "sem chave"} · nuvem: ${estadoBanco().configurado ? "centralizada" : "desligada"}`,
  );
});
