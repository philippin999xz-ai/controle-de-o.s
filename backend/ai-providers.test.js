import test from "node:test";
import assert from "node:assert/strict";
import { createAiGateway, AiUnavailable } from "./ai-providers.js";
const silent = { info() {}, warn() {} };
const photo = { mime: "image/png", image: "aGVsbG8=" };
const fields = { numero_os: "891234", equipamento: "M01", servico_solicitado: "Inspecionar", executante: "Técnico", tipo_manutencao: "Corretiva", observacoes: "", incertos: [] };
const message = { content: "Confira o código exato no manual antes de intervir.", executed_tools: [{ arguments: '{"query":"manual motor"}', search_results: [{ title: "Manual", url: "https://example.com/manual" }] }] };
const question = { equipamento: "Motor", codigo: "P04", sintoma: "O visor mostra um código." };
const chat = (data, reason = "stop") => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: reason }] }));
const nativeSearch = () => new Response(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }));

test("missing keys never trigger requests and paid OpenRouter models are excluded", async () => {
  let calls = 0;
  for (const env of [{}, { OPENROUTER_API_KEY: "private", OPENROUTER_VISION_MODEL: "paid/model", OPENROUTER_SEARCH_MODEL: "paid/model", TAVILY_API_KEY: "private" }]) {
    const gateway = createAiGateway({ env, logger: silent, fetchImpl: async () => { calls++; } });
    assert.equal(gateway.configured("vision"), false);
    assert.equal(gateway.configured("search"), false);
    await assert.rejects(gateway.vision(photo), (e) => e instanceof AiUnavailable && e.status === 503);
  }
  assert.equal(calls, 0);
});
test("vision switches Groq to Gemini on quota, honors Retry-After, then returns to Groq", async () => {
  let time = 1000;
  const hosts = [];
  let groqFails = true;
  const gateway = createAiGateway({ env: { GROQ_API_KEY: "groq-secret", GEMINI_API_KEY: "gemini-secret" }, now: () => time, logger: silent,
    fetchImpl: async (url, options) => {
      hosts.push(new URL(url).hostname);
      if (url.includes("groq.com")) {
        assert.equal(options.headers.Authorization, "Bearer groq-secret");
        return groqFails ? new Response("quota", { status: 429, headers: { "Retry-After": "120" } }) : chat(fields);
      }
      assert.equal(options.headers["x-goog-api-key"], "gemini-secret");
      const body = JSON.parse(options.body);
      assert.equal(body.contents[0].parts[1].inlineData.data, photo.image);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }] }));
    },
  });
  assert.equal((await gateway.vision(photo)).provedor, "gemini");
  assert.equal((await gateway.vision(photo)).provedor, "gemini");
  assert.equal(hosts.filter((h) => h.includes("groq")).length, 1);
  groqFails = false; time += 121000;
  assert.equal((await gateway.vision(photo)).provedor, "groq");
});
test("vision falls back after auth, network and malformed output, never logging secrets", async () => {
  for (const failure of ["auth", "network", "invalid"]) {
    const logs = [];
    const gateway = createAiGateway({ env: { GROQ_API_KEY: "secret-key", OPENROUTER_API_KEY: "router-key" }, logger: { info: (...a) => logs.push(a), warn: (...a) => logs.push(a) },
      fetchImpl: async (url, options) => {
        if (url.includes("groq.com")) {
          if (failure === "network") throw Error("secret-key");
          if (failure === "invalid") return chat({ bogus: true });
          return new Response("secret-key", { status: 401 });
        }
        const body = JSON.parse(options.body);
        assert.equal(body.model, "openrouter/free");
        assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
        assert.equal(body.messages[1].content[1].type, "image_url");
        return chat(fields);
      },
    });
    assert.equal((await gateway.vision(photo)).provedor, "openrouter");
    assert.doesNotMatch(JSON.stringify(logs), /secret-key|router-key|aGVsbG8/);
  }
});
test("research uses Gemini grounding after Groq quota, rejects missing evidence", async () => {
  for (const grounded of [true, false]) {
    const gateway = createAiGateway({ env: { GROQ_API_KEY: "private", GEMINI_API_KEY: "private" }, logger: silent,
      fetchImpl: async (url, options) => {
        if (url.includes("groq.com")) {
          const body = JSON.parse(options.body);
          assert.equal(body.max_completion_tokens, 2400);
          return new Response("quota", { status: 429 });
        }
        assert.deepEqual(JSON.parse(options.body).tools, [{ google_search: {} }]);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: message.content }] }, ...(grounded ? { groundingMetadata: { webSearchQueries: ["manual motor"], groundingChunks: [{ web: { uri: "https://example.com/manual", title: "Manual" } }] } } : {}) }] }));
      },
    });
    if (grounded) {
      const result = await gateway.research({ question, system: "Investigue com fontes." });
      assert.equal(result.provedor, "gemini");
      assert.equal(result.fontes[0].url, "https://example.com/manual");
    } else await assert.rejects(gateway.research({ question, system: "Investigue" }), AiUnavailable);
  }
});
test("separate web evidence is reused across OpenRouter, Cerebras and Hugging Face fallback", async () => {
  let searches = 0;
  const tried = [];
  const gateway = createAiGateway({ env: { OPENROUTER_API_KEY: "or-key", TAVILY_API_KEY: "web-key", CEREBRAS_API_KEY: "ce-key", CEREBRAS_MODEL: "free-model", HF_TOKEN: "hf-key", HF_MODEL: "free-text-model", HF_VISION_MODEL: "free-vision-model" }, logger: silent,
    fetchImpl: async (url, options) => {
      if (url.includes("tavily")) { searches++; return new Response(JSON.stringify({ results: [{ title: "Manual", url: "https://example.com/manual", content: "O código precisa ser confirmado." }] })); }
      tried.push(new URL(url).hostname);
      const body = JSON.parse(options.body);
      assert.match(body.messages[1].content, /fontesPesquisadas/);
      if (!url.includes("huggingface")) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: message.content } }] }));
    },
  });
  const result = await gateway.research({ question, system: "Investigue" });
  assert.equal(result.provedor, "huggingface");
  assert.equal(searches, 1);
  assert.deepEqual(tried, ["openrouter.ai", "api.cerebras.ai", "router.huggingface.co"]);
  assert.equal(result.fontes[0].url, "https://example.com/manual");
  assert.equal(gateway.status().find((p) => p.nome === "cerebras").imagens, false);
});
test("native Groq search remains grounded and stops at first successful provider", async () => {
  let calls = 0;
  const gateway = createAiGateway({ env: { GROQ_API_KEY: "private", GEMINI_API_KEY: "private" }, logger: silent, fetchImpl: async () => { calls++; return nativeSearch(); } });
  const result = await gateway.research({ question, system: "Investigue" });
  assert.equal(result.provedor, "groq");
  assert.equal(calls, 1);
});
test("all exhausted providers pause; no repeated API calls until cooldown expires", async () => {
  let calls = 0;
  const gateway = createAiGateway({ env: { GROQ_API_KEY: "private", OPENROUTER_API_KEY: "private" }, logger: silent,
    fetchImpl: async () => { calls++; return new Response("quota", { status: 429 }); },
  });
  await assert.rejects(gateway.vision(photo), (e) => e.status === 429 && e.retryAfter <= 60);
  assert.equal(calls, 2);
  await assert.rejects(gateway.vision(photo), AiUnavailable);
  assert.equal(calls, 2);
});
test("text-only providers without a search key never fabricate web results", async () => {
  let calls = 0;
  const gateway = createAiGateway({ env: { OPENROUTER_API_KEY: "private", CEREBRAS_API_KEY: "private", CEREBRAS_MODEL: "model", HF_TOKEN: "private", HF_MODEL: "model" }, logger: silent, fetchImpl: async () => { calls++; } });
  assert.equal(gateway.configured("search"), false);
  await assert.rejects(gateway.research({ question, system: "Investigue" }), AiUnavailable);
  assert.equal(calls, 0);
});
test("truncated research falls back instead of saving an incomplete answer", async () => {
  const gateway = createAiGateway({ env: { GROQ_API_KEY: "private", OPENROUTER_API_KEY: "private", TAVILY_API_KEY: "private" }, logger: silent,
    fetchImpl: async (url) => {
      if (url.includes("groq.com")) return new Response(JSON.stringify({ choices: [{ message, finish_reason: "length" }] }));
      if (url.includes("tavily")) return new Response(JSON.stringify({ results: [{ url: "https://example.com/manual", content: "manual" }] }));
      return new Response(JSON.stringify({ choices: [{ message: { content: message.content } }] }));
    },
  });
  assert.equal((await gateway.research({ question, system: "Investigue" })).provedor, "openrouter");
});
test("a single configured provider still retries HTTP 500 once, never 429", async () => {
  for (const status of [500, 429]) {
    let calls = 0;
    const gateway = createAiGateway({ env: { GROQ_API_KEY: "private" }, logger: silent,
      fetchImpl: async () => { calls++; return calls === 1 ? new Response("error", { status }) : nativeSearch(); },
    });
    if (status === 500) assert.equal((await gateway.research({ question, system: "Investigue" })).provedor, "groq");
    else await assert.rejects(gateway.research({ question, system: "Investigue" }), AiUnavailable);
    assert.equal(calls, status === 500 ? 2 : 1);
  }
});
