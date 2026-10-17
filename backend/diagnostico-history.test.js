import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createClient } from "@libsql/client";
import { diagnosticRouter } from "./diagnostico.js";

test("diagnostic history persists queries and results, paginates and isolates accounts", async () => {
  const db = createClient({ url: "file::memory:" });
  await db.execute("CREATE TABLE pesquisas_diagnostico(id TEXT PRIMARY KEY,usuario_id TEXT NOT NULL,equipamento TEXT NOT NULL,codigo TEXT NOT NULL,sintoma TEXT NOT NULL,resultado TEXT NOT NULL,criado_em TEXT NOT NULL)");
  let calls = 0;
  const result = {
    content: "Confirme o código completo no visor.",
    executed_tools: [{ arguments: '{"query":"manual modelo"}', search_results: [{ title: "Manual", url: "https://example.com/manual" }] }],
  };
  const app = express();
  app.use(express.json());
  // Two test identities stand in for the production session middleware.
  app.use((req, _res, next) => { req.user = { id: req.headers["x-test-user"] || "a" }; next(); });
  app.use("/", diagnosticRouter({ apiKey: "test", db: () => db,
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: result }] })); },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, user = "a", body) {
    return fetch(base + path, { method: body ? "POST" : "GET", headers: { "x-test-user": user, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  try {
    const q = { equipamento: "CFW300", codigo: "P04", sintoma: "O visor apresenta este código." };
    const created = await (await request("/", "a", q)).json();
    assert.equal(created.historicoSalvo, true);
    const saved = (await db.execute("SELECT * FROM pesquisas_diagnostico")).rows[0];
    assert.equal(saved.usuario_id, "a");
    assert.equal(saved.codigo, "P04");
    assert.equal(JSON.parse(saved.resultado).fontes[0].url, "https://example.com/manual");
    const list = await (await request("/historico")).json();
    assert.equal(list.pesquisas[0].id, created.historicoId);
    const detail = await (await request("/historico/" + created.historicoId)).json();
    assert.equal(detail.sintoma, q.sintoma);
    assert.equal(detail.resultado.resposta, result.content);
    assert.equal(detail.usuario_id, undefined);
    assert.equal(calls, 1, "reopening history must never invoke the provider");
    assert.equal((await request("/historico/" + created.historicoId, "b")).status, 404);
    assert.deepEqual((await (await request("/historico", "b")).json()).pesquisas, []);
    for (let i = 0; i < 21; i++) await db.execute({ sql: "INSERT INTO pesquisas_diagnostico VALUES(?,?,?,?,?,?,?)", args: ["extra" + i, "a", "Motor", "", "Sintoma", "{}", new Date().toISOString()] });
    const page = await (await request("/historico")).json();
    assert.equal(page.pesquisas.length, 20);
    assert.equal(page.proximo, 20);
    const second = await (await request("/historico?offset=20")).json();
    assert.equal(second.pesquisas.length, 2);
    assert.equal(second.proximo, null);
    assert.equal((await request("/historico?offset=-1")).status, 400);
    assert.equal((await request("/", "a", { sintoma: "curto" })).status, 400);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM pesquisas_diagnostico")).rows[0].n, 22);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
