import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { diagnosticRouter, normalizeGrounded } from "./diagnostico.js";
const message = {
  content: "Hipótese: falha de ventilação. Consulte o manual antes de intervir.",
  executed_tools: [
    {
      type: "search",
      arguments: JSON.stringify({ query: "motor falha ventilação manual fabricante" }),
      search_results: {
        results: [{ title: "Manual do fabricante", url: "https://example.com/manual" }],
      },
    },
  ],
};
async function withAPI(options, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/diagnostico", diagnosticRouter(options));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    await run((data) =>
      fetch(`http://127.0.0.1:${server.address().port}/api/diagnostico`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const question = {
  equipamento: "Motor de indução",
  codigo: "",
  sintoma: "A temperatura sobe durante a operação.",
};
test("requires evidence of web search and usable sources", () => {
  assert.equal(normalizeGrounded({ ...message, executed_tools: [] }), null);
  assert.equal(
    normalizeGrounded({
      ...message,
      executed_tools: [{ ...message.executed_tools[0], arguments: "{}" }],
    }),
    null,
  );
  assert.equal(
    normalizeGrounded({
      ...message,
      executed_tools: [
        {
          ...message.executed_tools[0],
          search_results: { results: [{ url: "javascript:alert(1)" }] },
        },
      ],
    }),
    null,
  );
  assert.equal(
    normalizeGrounded(message).fontes[0].titulo,
    "Manual do fabricante",
  );
  assert.ok(
    !normalizeGrounded({ ...message, content: "Texto【2†L6-L10】 final" }).resposta.includes("【"),
  );
});
test("validates input and reports missing configuration without invoking the provider", async () => {
  await withAPI({ apiKey: "" }, async (request) => {
    assert.equal(
      (await request({ ...question, sintoma: "curto" })).status,
      400,
    );
    assert.equal(
      (await request({ ...question, extra: "unexpected" })).status,
      400,
    );
    assert.equal((await request(question)).status, 503);
  });
});
test("enables web search on server and returns real provider metadata", async () => {
  let called = false;
  await withAPI(
    {
      apiKey: "test-only-not-a-credential",
      fetchImpl: async (url, options) => {
        called = true;
        const body = JSON.parse(options.body);
        assert.match(url, /\/chat\/completions$/);
        assert.equal(options.headers.Authorization, "Bearer test-only-not-a-credential");
        assert.match(body.messages[0].content, /P04, P004, F004 e A004 não são equivalentes/);
        assert.match(body.messages[0].content, /Não infira sintomas ausentes/);
        assert.match(body.messages[0].content, /Não use Markdown/);
        assert.equal(body.model, "openai/gpt-oss-120b");
        assert.deepEqual(body.tools, [{ type: "browser_search" }]);
        assert.equal(JSON.parse(body.messages[1].content).sintoma, question.sintoma);
        return new Response(JSON.stringify({ choices: [{ message }] }), {
          status: 200,
        });
      },
    },
    async (request) => {
      const response = await request(question);
      assert.equal(response.status, 200);
      const json = await response.json();
      assert.equal(json.fontes[0].url, "https://example.com/manual");
      assert.equal(json.resposta, message.content);
      assert.ok(!JSON.stringify(json).includes("test-only-not-a-credential"));
      assert.ok(json.pesquisadoEm);
    },
  );
  assert.equal(called, true);
});
test("rejects an answer without grounded sources", async () => {
  await withAPI(
    {
      apiKey: "test",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: message.content } }] }),
        ),
    },
    async (request) => {
      const r = await request(question);
      assert.equal(r.status, 422);
      assert.equal((await r.json()).error.code, "SEARCH_NOT_GROUNDED");
    },
  );
});
test("handles provider rate limits and does not expose provider response or keys", async () => {
  await withAPI(
    {
      apiKey: "test",
      fetchImpl: async () =>
        new Response("private upstream details", { status: 429 }),
    },
    async (request) => {
      const r = await request(question);
      assert.equal(r.status, 429);
      assert.ok(!(await r.text()).includes("private upstream details"));
    },
  );
});

test("classifies provider refusals without leaking upstream text or credentials", async () => {
  for (const [status, code, expected] of [
    [401, "invalid_api_key", "SEARCH_PROVIDER_AUTH"],
    [403, "access_denied", "SEARCH_PROVIDER_AUTH"],
    [404, "model_not_found", "SEARCH_MODEL_UNAVAILABLE"],
    [400, "invalid_request_error", "SEARCH_REQUEST_REJECTED"],
    [503, "unavailable", "SEARCH_PROVIDER_ERROR"],
  ]) {
    const logs = [];
    await withAPI({
      apiKey: "private-key",
      logger: { warn: (...args) => logs.push(args) },
      fetchImpl: async () => new Response(JSON.stringify({
        error: { code, message: "private-key private-question upstream details" },
      }), { status }),
    }, async (request) => {
      const response = await request(question);
      assert.equal(response.status, 502);
      const result = await response.json();
      assert.equal(result.error.code, expected);
      assert.equal(logs[0][1].status, status);
      assert.equal(logs[0][1].category, expected);
      assert.doesNotMatch(JSON.stringify([result, logs]), /private-key|private-question|upstream details/);
    });
  }
});

test("does not present a truncated investigation as a complete answer", async () => {
  await withAPI({
    apiKey: "test",
    logger: { warn() {} },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message, finish_reason: "length" }],
    })),
  }, async (request) => {
    const response = await request(question);
    assert.equal(response.status, 422);
    const result = await response.json();
    assert.equal(result.error.code, "SEARCH_INCOMPLETE");
    assert.equal(result.resposta, undefined);
  });
});
