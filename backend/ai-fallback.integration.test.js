import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

test("authenticated HTTP routes fail over and persist grounded results in shared database", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "os-ai-fallback-"));
  const url = "file:" + path.join(directory, "test.db");
  const db = createClient({ url });
  let groqCalls = 0, geminiCalls = 0;
  const mock = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/groq/")) {
      groqCalls++;
      assert.equal(req.headers.authorization, "Bearer private-groq");
      res.writeHead(429, { "Retry-After": "60" });
      return res.end(JSON.stringify({ error: { code: "rate_limit_exceeded" } }));
    }
    geminiCalls++;
    assert.equal(req.headers["x-goog-api-key"], "private-gemini");
    const image = body.contents[0].parts.some((p) => p.inlineData);
    const text = image ? JSON.stringify({ numero_os: "891234", equipamento: "M01", servico_solicitado: "Verificar", executante: "Técnico", tipo_manutencao: "Corretiva", observacoes: "", incertos: [] }) : "Confirme o código exato no visor antes de intervir.";
    res.end(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] }, ...(!image ? { groundingMetadata: { webSearchQueries: ["manual motor P04"], groundingChunks: [{ web: { title: "Manual", uri: "https://example.com/manual" } }] } } : {}) }] }));
  });
  mock.listen(0, "127.0.0.1");
  await new Promise((resolve) => mock.once("listening", resolve));
  const remote = `http://127.0.0.1:${mock.address().port}`;
  const reserve = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => reserve.once("listening", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const child = spawn(process.execPath, ["backend/server.js"], { cwd: process.cwd(), stdio: "ignore", env: {
    ...process.env, PORT: String(port), TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "",
    ADMIN_NAME: "Demo Admin", ADMIN_PIN: "123456", GROQ_API_KEY: "private-groq", GEMINI_API_KEY: "private-gemini",
    GROQ_BASE_URL: remote + "/groq", GEMINI_BASE_URL: remote + "/gemini", GROQ_MODELS: "vision-model",
    OPENROUTER_API_KEY: "", CEREBRAS_API_KEY: "", HF_TOKEN: "", TAVILY_API_KEY: "",
  } });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await (await fetch(base + "/api/auth/status")).json()).hasUsers) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    const health = await (await fetch(base + "/api/health")).json();
    assert.equal(health.ai, true);
    assert.equal(health.research, true);
    assert.deepEqual(health.providers.map((p) => p.nome), ["groq", "gemini"]);
    assert.doesNotMatch(JSON.stringify(health), /private-groq|private-gemini/);
    const login = await (await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "Demo Admin", pin: "123456" }) })).json();
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + login.token };
    const question = { equipamento: "Motor", codigo: "P04", sintoma: "O visor apresenta este código." };
    const unauthorized = await fetch(base + "/api/diagnostico", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(question) });
    assert.equal(unauthorized.status, 401);
    assert.equal(groqCalls + geminiCalls, 0);
    const response = await fetch(base + "/api/diagnostico", { method: "POST", headers, body: JSON.stringify(question) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.provedor, "gemini");
    assert.equal(result.historicoSalvo, true);
    const persisted = (await db.execute("SELECT resultado FROM pesquisas_diagnostico")).rows;
    assert.equal(persisted.length, 1);
    assert.equal(JSON.parse(persisted[0].resultado).provedor, "gemini");
    const photo = await fetch(base + "/api/ler-os", { method: "POST", headers, body: JSON.stringify({ mime: "image/png", image: "a".repeat(120) }) });
    assert.equal(photo.status, 200);
    const data = await photo.json();
    assert.equal(data.campos.numero_os, "891234");
    assert.equal(data.provedor, "gemini");
    assert.equal(groqCalls, 2, "separate model capabilities each check quota once");
    assert.equal(geminiCalls, 2);
    const saved = await (await fetch(base + "/api/diagnostico/historico/" + result.historicoId, { headers })).json();
    assert.equal(saved.resultado.resposta, result.resposta);
    assert.equal(geminiCalls, 2, "history must not invoke a provider");
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => mock.close(resolve));
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
