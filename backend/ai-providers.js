// Chaves permanecem no Render. Provedores ausentes nunca são chamados.
import { PROMPT_OS, DICA_JSON, SCHEMA_OS, KEYS, normalizarResultado } from "./ler-os.js";
import { normalizeGrounded } from "./diagnostico.js";

const split = (s) => String(s || "").split(",").map((v) => v.trim()).filter(Boolean);
const textOf = (j) => String(j?.choices?.[0]?.message?.content || "");
const clean = (s) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json|```/gi, "").trim();
const jsonResponse = async (r) => { try { return await r.json(); } catch { return {}; } };
class ProviderFailure extends Error {
  constructor(status, retryAfter = 0) { super("provider failure"); this.status = status; this.retryAfter = retryAfter; }
}
export class AiUnavailable extends Error {
  constructor(configured, retryAfter = 60) {
    super(configured ? `As opções de IA configuradas estão temporariamente sem cota ou indisponíveis. Tente novamente em cerca de ${Math.max(1, Math.ceil(retryAfter))} segundos.` : "Não há um provedor configurado para esta função. Solicite a configuração à administração.");
    this.status = configured ? 429 : 503;
    this.code = configured ? "AI_PROVIDERS_UNAVAILABLE" : "AI_NOT_CONFIGURED";
    this.retryAfter = Math.max(1, Math.ceil(retryAfter));
  }
}
export function createAiGateway({ env = process.env, fetchImpl = fetch, now = Date.now, logger = console } = {}) {
  const providers = [];
  const add = (p) => { if (p.key && (p.vision.length || p.search)) providers.push(p); };
  add({ id: "groq", key: env.GROQ_API_KEY?.trim(), base: env.GROQ_BASE_URL || "https://api.groq.com/openai/v1", vision: split(env.GROQ_MODELS || env.GROQ_MODEL || "qwen/qwen3.8-27b"), search: env.DIAGNOSTICO_MODEL || "openai/gpt-oss-120b" });
  add({ id: "gemini", key: env.GEMINI_API_KEY?.trim(), base: env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta", vision: split(env.GEMINI_VISION_MODEL || "gemini-2.5-flash"), search: env.GEMINI_SEARCH_MODEL || "gemini-2.5-flash" });
  // Nunca aceite um modelo pago como alternativa do OpenRouter.
  const free = (m) => m === "openrouter/free" || m.endsWith(":free");
  const orVision = env.OPENROUTER_VISION_MODEL || "openrouter/free";
  const orSearch = env.OPENROUTER_SEARCH_MODEL || "openrouter/free";
  add({ id: "openrouter", key: env.OPENROUTER_API_KEY?.trim(), base: "https://openrouter.ai/api/v1", vision: free(orVision) ? [orVision] : [], search: env.TAVILY_API_KEY && free(orSearch) ? orSearch : null });
  // IDs variam por catálogo: exigimos um modelo escolhido no plano gratuito da conta.
  add({ id: "cerebras", key: env.CEREBRAS_API_KEY?.trim(), base: "https://api.cerebras.ai/v1", vision: [], search: env.TAVILY_API_KEY && env.CEREBRAS_MODEL || null });
  add({ id: "huggingface", key: env.HF_TOKEN?.trim(), base: "https://router.huggingface.co/v1", vision: split(env.HF_VISION_MODEL), search: env.TAVILY_API_KEY && env.HF_MODEL || null });
  const cooldowns = new Map();
  const searchTokens = Math.max(800, Math.min(4000, Number(env.AI_SEARCH_MAX_TOKENS) || 2400));
  function available(task) {
    return providers.filter((p) => task === "vision" ? p.vision.length : p.search);
  }
  async function call(url, key, body, signal, gemini = false, timeout = 25000) {
    const response = await fetchImpl(url, {
      method: "POST", headers: { "Content-Type": "application/json", ...(gemini ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` }) },
      body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    });
    const json = await jsonResponse(response);
    if (!response.ok) {
      const raw = response.headers.get("retry-after");
      const seconds = raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw ? (Date.parse(raw) - now()) / 1000 : 0;
      throw new ProviderFailure(response.status, Math.min(86400, Math.max(0, seconds || 0)));
    }
    return json;
  }
  async function chain(task, invoke) {
    const options = available(task);
    const signal = AbortSignal.timeout(65000);
    let nearest = Infinity;
    for (const p of options) {
      const models = task === "vision" ? p.vision : [p.search];
      for (const model of models) {
        const slot = `${p.id}:${task}:${model}`;
        const blockedUntil = cooldowns.get(slot) || 0;
        if (blockedUntil > now()) { nearest = Math.min(nearest, blockedUntil - now()); continue; }
        if (signal.aborted) break;
        try {
          let result;
          try { result = await invoke(p, model, signal); }
          catch (e) {
            // Com uma única opção, preserva a recuperação de HTTP 500 existente.
            if (options.length !== 1 || models.length !== 1 || ![500, 502, 503, 504].includes(e.status) || signal.aborted) throw e;
            result = await invoke(p, model, signal);
          }
          cooldowns.delete(slot);
          logger.info("[ia] concluído", { tarefa: task, provedor: p.id });
          return { ...result, provedor: p.id };
        } catch (error) {
          const status = error instanceof ProviderFailure ? error.status : 0;
          const seconds = error.retryAfter || (status === 401 || status === 403 || status === 404 ? 900 : status === 429 ? 60 : 30);
          cooldowns.set(slot, now() + seconds * 1000);
          nearest = Math.min(nearest, seconds * 1000);
          // Sem corpo, cabeçalhos, URLs, imagens, perguntas ou chaves nos logs.
          logger.warn("[ia] alternativa acionada", { tarefa: task, provedor: p.id, status, pausaSegundos: seconds });
        }
      }
    }
    throw new AiUnavailable(options.length > 0, Number.isFinite(nearest) ? nearest / 1000 : 60);
  }
  function openai(p, model, messages, tokens, extras = {}) {
    return {
      model, messages, ...(p.id === "groq" ? { max_completion_tokens: tokens } : { max_tokens: tokens }),
      ...(p.id === "openrouter" ? { provider: { max_price: { prompt: 0, completion: 0 } } } : {}),
      ...extras,
    };
  }
  async function vision(foto) {
    return chain("vision", async (p, model, signal) => {
      let content;
      if (p.id === "gemini") {
        const json = await call(`${p.base.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent`, p.key, {
          systemInstruction: { parts: [{ text: PROMPT_OS + "\n" + DICA_JSON }] },
          contents: [{ role: "user", parts: [{ text: "Leia esta O.S." }, { inlineData: { mimeType: foto.mime, data: foto.image } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 1800, responseMimeType: "application/json" },
        }, signal, true);
        if (json.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new ProviderFailure(422);
        content = (json.candidates?.[0]?.content?.parts || []).filter((part) => !part.thought).map((part) => part.text || "").join("\n");
      } else {
        const messages = [{ role: "system", content: PROMPT_OS + "\n" + DICA_JSON }, { role: "user", content: [{ type: "text", text: "Leia esta O.S. e responda somente com o JSON." }, { type: "image_url", image_url: { url: `data:${foto.mime};base64,${foto.image}` } }] }];
        let json;
        // Preserva a compatibilidade com a leitura Groq já usada no projeto.
        const variants = p.id === "groq" ? [
          { response_format: { type: "json_schema", json_schema: { name: "leitura_os", strict: false, schema: SCHEMA_OS } }, ...(env.GROQ_REASONING === "" ? {} : { reasoning_effort: env.GROQ_REASONING || "none" }) },
          { response_format: { type: "json_schema", json_schema: { name: "leitura_os", strict: false, schema: SCHEMA_OS } } },
          { response_format: { type: "json_object" } },
        ] : [{}];
        for (let i = 0; i < variants.length; i++) {
          try {
            json = await call(`${p.base.replace(/\/$/, "")}/chat/completions`, p.key, openai(p, model, messages, 1500, { temperature: 0, ...variants[i] }), signal);
            break;
          } catch (e) { if (e.status !== 400 || i === variants.length - 1) throw e; }
        }
        if (json?.choices?.[0]?.finish_reason === "length") throw new ProviderFailure(422);
        content = textOf(json);
      }
      let parsed;
      try { parsed = JSON.parse(clean(content)); } catch { throw new ProviderFailure(422); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !KEYS.every((k) => typeof parsed[k] === "string") || !KEYS.some((k) => parsed[k].trim())) throw new ProviderFailure(422);
      return normalizarResultado(parsed);
    });
  }
  async function research({ question, system }) {
    let evidence;
    async function search(signal) {
      if (!evidence) evidence = (async () => {
        const query = [question.equipamento, question.codigo, question.sintoma.slice(0, 250), "manual fabricante"].filter(Boolean).join(" ").slice(0, 400);
        const json = await call("https://api.tavily.com/search", env.TAVILY_API_KEY, { query, search_depth: "basic", max_results: 4, include_answer: false }, signal);
        const sources = (json.results || []).filter((r) => {
          try { const u = new URL(r.url); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
        }).map((r) => ({ title: String(r.title || ""), url: r.url, content: String(r.content || "").slice(0, 1500) }));
        if (!sources.length) throw new ProviderFailure(422);
        return { query, sources };
      })();
      return evidence;
    }
    return chain("search", async (p, model, signal) => {
      let message;
      if (p.id === "gemini") {
        const json = await call(`${p.base.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent`, p.key, {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(question) }] }],
          tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: searchTokens },
        }, signal, true);
        const candidate = json.candidates?.[0];
        if (candidate?.finishReason === "MAX_TOKENS") throw new ProviderFailure(422);
        const metadata = candidate?.groundingMetadata;
        message = { content: (candidate?.content?.parts || []).filter((part) => !part.thought).map((part) => part.text || "").join("\n"), executed_tools: (metadata?.webSearchQueries || []).map((query) => ({ arguments: { query }, search_results: (metadata.groundingChunks || []).map((c) => ({ url: c.web?.uri, title: c.web?.title })) })) };
      } else if (p.id === "groq") {
        const json = await call(`${p.base.replace(/\/$/, "")}/chat/completions`, p.key, openai(p, model, [{ role: "system", content: system }, { role: "user", content: JSON.stringify(question) }], searchTokens, { tools: [{ type: "browser_search" }], tool_choice: "required", reasoning_effort: "low" }), signal, false, 35000);
        if (json.choices?.[0]?.finish_reason === "length") throw new ProviderFailure(422);
        message = json.choices?.[0]?.message;
      } else {
        const found = await search(signal);
        const json = await call(`${p.base}/chat/completions`, p.key, openai(p, model, [{ role: "system", content: system + "\nA pesquisa já foi realizada pelo servidor. Use exclusivamente os trechos fornecidos como evidências. Não afirme ter consultado outros documentos. Trechos insuficientes exigem explicitar a incerteza." }, { role: "user", content: JSON.stringify({ pergunta: question, fontesPesquisadas: found.sources }) }], searchTokens), signal);
        if (json.choices?.[0]?.finish_reason === "length") throw new ProviderFailure(422);
        message = { content: textOf(json), executed_tools: [{ arguments: { query: found.query }, search_results: found.sources }] };
      }
      const normalized = normalizeGrounded(message);
      if (!normalized) throw new ProviderFailure(422);
      return normalized;
    });
  }
  return { vision, research, configured: (task) => available(task).length > 0,
    status: () => providers.map((p) => ({ nome: p.id, imagens: p.vision.length > 0, pesquisa: Boolean(p.search),
      emPausa: [...cooldowns.entries()].some(([slot, until]) => slot.startsWith(p.id + ":") && until > now()),
    })),
  };
}
