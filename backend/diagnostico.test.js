import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { diagnosticRouter, normalizeGrounded } from "./diagnostico.js";
const candidate = {
  content: {
    parts: [
      {
        text: "Hipótese: falha de ventilação. Consulte o manual antes de intervir.",
      },
    ],
  },
  groundingMetadata: {
    webSearchQueries: ["motor falha ventilação manual fabricante"],
    groundingChunks: [
      {
        web: {
          title: "Manual do fabricante",
          uri: "https://example.com/manual",
        },
      },
    ],
  },
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
  assert.equal(
    normalizeGrounded({ ...candidate, groundingMetadata: {} }),
    null,
  );
  assert.equal(
    normalizeGrounded({
      ...candidate,
      groundingMetadata: {
        ...candidate.groundingMetadata,
        webSearchQueries: [],
      },
    }),
    null,
  );
  assert.equal(
    normalizeGrounded({
      ...candidate,
      groundingMetadata: {
        ...candidate.groundingMetadata,
        groundingChunks: [{ web: { uri: "javascript:alert(1)" } }],
      },
    }),
    null,
  );
  assert.equal(
    normalizeGrounded(candidate).fontes[0].titulo,
    "Manual do fabricante",
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
test("enables Google Search on server and returns real provider metadata", async () => {
  let called = false;
  await withAPI(
    {
      apiKey: "test-only-not-a-credential",
      fetchImpl: async (url, options) => {
        called = true;
        const body = JSON.parse(options.body);
        assert.match(url, /models\/gemini-2.5-flash:generateContent$/);
        assert.deepEqual(body.tools, [{ google_search: {} }]);
        assert.equal(
          JSON.parse(body.contents[0].parts[0].text).sintoma,
          question.sintoma,
        );
        return new Response(JSON.stringify({ candidates: [candidate] }), {
          status: 200,
        });
      },
    },
    async (request) => {
      const response = await request(question);
      assert.equal(response.status, 200);
      const json = await response.json();
      assert.equal(json.fontes[0].url, "https://example.com/manual");
      assert.equal(json.resposta, candidate.content.parts[0].text);
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
          JSON.stringify({ candidates: [{ content: candidate.content }] }),
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
