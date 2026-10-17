// Conexão com o backend no Render. O plano gratuito "dorme" e a 1ª resposta pode levar ~1 min:
// por isso o app "acorda" o servidor ao abrir e tenta de novo, em vez de falhar na primeira.
// Onde está o backend: VITE_API_BASE se definido; no GitHub Pages, o Render; senão a própria origem
// (front e API no mesmo serviço do Render, ou "npm run dev" com proxy).
const RENDER_URL = "https://controle-de-o-s.onrender.com";
const noPages =
  typeof location !== "undefined" && /\.github\.io$/.test(location.hostname);
export const API_BASE = String(
  import.meta.env.VITE_API_BASE || (noPages ? RENDER_URL : ""),
).replace(/\/$/, "");
import { getToken } from "./store.js";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
export { req };
export class ErroApi extends Error {
  constructor(codigo, detalhe) {
    super(detalhe || codigo);
    this.codigo = codigo;
    this.fatal = false;
  }
}

async function req(path, opts = {}, ms = 90000) {
  const ctl = new AbortController(),
    t = setTimeout(() => ctl.abort(), ms);
  const tok = getToken();
  try {
    const response = await fetch(API_BASE + path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        ...(tok ? { Authorization: "Bearer " + tok } : {}),
      },
      signal: ctl.signal,
      cache: "no-store",
    });
    if (
      response.status === 401 &&
      path !== "/api/auth/login" &&
      tok &&
      getToken() === tok
    )
      window.dispatchEvent(new Event("os:session-expired"));
    return response;
  } finally {
    // sem cookies: evita bloqueio de CORS
    clearTimeout(t);
  }
}

export async function acordar(onStatus = () => {}) {
  const ini = Date.now();
  for (let i = 0; i < 12; i++) {
    try {
      const r = await req("/api/health", {}, 12000);
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        onStatus("online", { ai: !!j.ai, sync: !!j.sync, auth: !!j.auth });
        return { ok: true, ai: !!j.ai, sync: !!j.sync, auth: !!j.auth };
      }
      onStatus("acordando", { http: r.status });
    } catch (e) {
      onStatus("acordando", { seg: Math.round((Date.now() - ini) / 1000) });
    }
    await espera(4000);
  }
  onStatus("offline");
  return { ok: false, ai: false };
}

// Envia só a foto (base64). O servidor tem o prompt e a chave do Groq e devolve {campos, incertos}.
export async function lerOS(image, mime = "image/jpeg") {
  let ultimo = null;
  for (let tent = 0; tent < 3; tent++) {
    try {
      const r = await req("/api/ler-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, mime }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.campos) return j;
      if (r.status === 503)
        throw Object.assign(new ErroApi("ia_off", j?.error?.message), {
          fatal: true,
        });
      if (r.status === 401 || r.status === 429)
        throw Object.assign(
          new ErroApi(
            "auth",
            j?.error?.message ||
              "Sessão expirada ou sem permissão. Entre novamente.",
          ),
          { fatal: true },
        );
      const e = new ErroApi(
        "http",
        (j?.error?.message || "Falha") + " [HTTP " + r.status + "]",
      );
      if ([400, 401, 403, 413, 422].includes(r.status)) {
        e.fatal = true;
        throw e;
      }
      ultimo = e;
    } catch (e) {
      if (e.fatal) throw e;
      ultimo =
        e instanceof ErroApi
          ? e
          : new ErroApi(
              e.name === "AbortError" ? "tempo" : "rede",
              e.name === "AbortError"
                ? "Tempo esgotado esperando o servidor."
                : "Sem conexão com o servidor (" +
                    (e.message || "falha de rede") +
                    ").",
            );
    }
    await espera(1500);
  }
  throw ultimo || new ErroApi("rede");
}

export function erroAmigavel(e) {
  const s = {
    rede: "Sem conexão com o servidor.",
    tempo: "O servidor demorou demais.",
    ia_off:
      "Leitura automática indisponível (GROQ_API_KEY não configurada no servidor).",
    http: "Não consegui ler a foto.",
  };
  return e?.message || s[e?.codigo] || s.http;
}

// Pesquisa técnica com busca na web feita somente no backend. O front não repete pedidos;
// o servidor permite uma nova tentativa apenas após HTTP 500/502/503/504.
export async function pesquisarFalha(dados) {
  try {
    const r = await req(
      "/api/diagnostico",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      },
      75000,
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new ErroApi(
        "diagnostico",
        j?.error?.message || "Não foi possível concluir a pesquisa.",
      );
    return j;
  } catch (e) {
    if (e instanceof ErroApi) throw e;
    throw new ErroApi(
      "rede",
      e.name === "AbortError"
        ? "A pesquisa demorou demais. Tente novamente."
        : "Sem conexão com o assistente. Verifique a conexão e tente novamente.",
    );
  }
}
