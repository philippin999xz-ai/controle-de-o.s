import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { createClient } from "@libsql/client";
async function port() {
  const s = net.createServer();
  s.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function start(url, admin = true) {
  const p = await port(),
    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(p),
        TURSO_DATABASE_URL: url,
        TURSO_AUTH_TOKEN: "",
        ADMIN_NAME: admin ? "Central Admin" : "",
        ADMIN_PIN: admin ? "123456" : "",
        GROQ_API_KEY: "",
      },
      stdio: "ignore",
    });
  const base = "http://127.0.0.1:" + p;
  for (let n = 0; n < 100; n++) {
    try {
      const r = await fetch(base + "/api/auth/status");
      if (r.ok && (!admin || (await r.json()).hasUsers)) return { base, child };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw Error("server startup failed");
}
async function call(base, p, { method = "GET", body, token } = {}) {
  return fetch(base + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login(base, nome, pin) {
  const r = await call(base, "/api/auth/login", {
    method: "POST",
    body: { nome, pin },
  });
  assert.equal(r.status, 200);
  return r.json();
}
test("central identities, authorization, shared data, revocation and restart persistence", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "os-central-"));
  const url = "file:" + path.join(dir, "central.db");
  let a, b;
  const db = createClient({ url });
  try {
    a = await start(url);
    b = await start(url);
    const admin = await login(a.base, "Central Admin", "123456");
    await t.test(
      "credentials never appear in account snapshots; shared service token cannot impersonate a user",
      async () => {
        assert.equal((await call(a.base, "/api/auth/me")).status, 401);
        assert.equal(
          (await call(a.base, "/api/sync/os", { token: "not-a-user-session" }))
            .status,
          401,
        );
        const snapshot = await (
          await call(a.base, "/api/auth/me", { token: admin.token })
        ).json();
        assert.ok(!JSON.stringify(snapshot).includes("salt"));
        assert.ok(!JSON.stringify(snapshot).includes("hash"));
        assert.ok(!JSON.stringify(snapshot).includes("123456"));
      },
    );
    let worker;
    await t.test(
      "a user created on server A can sign in on independent server B",
      async () => {
        const r = await call(a.base, "/api/auth/users", {
          method: "POST",
          token: admin.token,
          body: { nome: "Shared Technician", pin: "654321", cargo: "Técnico" },
        });
        assert.equal(r.status, 201);
        worker = await login(b.base, "Shared Technician", "654321");
        assert.equal(worker.user.nome, "Shared Technician");
        assert.equal(
          (
            await call(b.base, "/api/auth/users", {
              method: "POST",
              token: worker.token,
              body: { nome: "Intruder", pin: "999999", cargo: "Administrador" },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "real SQLite persistence of an order created from one authenticated client and read by another",
      async () => {
        const data = {
          itens: [
            {
              id: "central-proof",
              v: "2026-10-16T01:00:00Z",
              dados: {
                numero_os: "TESTE-TURSO-CENTRAL",
                equipamento: "PR-01",
                criado: "2026-10-16T01:00:00Z",
                usuario_id: "forged",
              },
            },
          ],
        };
        assert.equal(
          (
            await call(b.base, "/api/sync/os", {
              method: "POST",
              token: worker.token,
              body: data,
            })
          ).status,
          200,
        );
        const raw = await db.execute(
          "SELECT dados FROM os WHERE id='central-proof'",
        );
        assert.equal(JSON.parse(raw.rows[0].dados).usuario_id, worker.user.id);
        const r = await (
          await call(a.base, "/api/sync/os", { token: admin.token })
        ).json();
        assert.equal(r.itens[0].dados.numero_os, "TESTE-TURSO-CENTRAL");
        assert.equal(
          (
            await call(b.base, "/api/sync/os", {
              method: "POST",
              token: worker.token,
              body: {
                itens: [
                  {
                    id: "central-proof",
                    v: "2026-10-17T01:00:00Z",
                    apagado: true,
                  },
                ],
              },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "photo writes require ownership or edit permission",
      async () => {
        const put = (token) =>
          fetch(b.base + "/api/sync/foto/central-proof", {
            method: "PUT",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "image/jpeg",
            },
            body: new Uint8Array(100),
          });
        assert.equal((await put(worker.token)).status, 200);
        assert.equal((await put(worker.token)).status, 403);
        assert.equal((await put(admin.token)).status, 200);
        const read = await call(a.base, "/api/sync/foto/central-proof", {
          token: admin.token,
        });
        assert.equal(read.status, 200);
        assert.equal((await read.arrayBuffer()).byteLength, 100);
      },
    );
    await t.test(
      "PIN resets apply across devices and invalidate all old sessions",
      async () => {
        const r = await call(a.base, "/api/auth/users/" + worker.user.id, {
          method: "PUT",
          token: admin.token,
          body: {
            nome: worker.user.nome,
            cargo: "Técnico",
            ativo: true,
            pin: "777777",
          },
        });
        assert.equal(r.status, 200);
        assert.equal(
          (await call(b.base, "/api/auth/me", { token: worker.token })).status,
          401,
        );
        worker = await login(b.base, "Shared Technician", "777777");
      },
    );
    await t.test(
      "server enforces the last administrator and self-deletion protections",
      async () => {
        assert.equal(
          (
            await call(a.base, "/api/auth/users/" + admin.user.id, {
              method: "PUT",
              token: admin.token,
              body: { nome: admin.user.nome, cargo: "Técnico", ativo: true },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call(a.base, "/api/auth/users/" + admin.user.id, {
              method: "DELETE",
              token: admin.token,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "pagination does not drop records above one page",
      async () => {
        const statements = Array.from({ length: 505 }, (_, i) => ({
          sql: "INSERT INTO os(id,dados,v,atualizado_em) VALUES(?,?,?,?)",
          args: [
            "page-" + i,
            JSON.stringify({
              id: "page-" + i,
              numero_os: String(i),
              usuario_id: worker.user.id,
            }),
            "2026-10-16",
            100,
          ],
        }));
        await db.batch(statements, "write");
        let cursor = "",
          count = 0;
        do {
          const r = await (
            await call(
              a.base,
              "/api/sync/os" +
                (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
              { token: admin.token },
            )
          ).json();
          count += r.itens.length;
          cursor = r.proximo;
        } while (cursor);
        assert.equal(count, 506);
      },
    );
    await t.test("logout revokes the session in shared storage", async () => {
      assert.equal(
        (
          await call(a.base, "/api/auth/logout", {
            method: "POST",
            token: worker.token,
          })
        ).status,
        200,
      );
      assert.equal(
        (await call(b.base, "/api/auth/me", { token: worker.token })).status,
        401,
      );
    });
    await t.test(
      "users remain after a process restart; bootstrap environment never overwrites existing users",
      async () => {
        b.child.kill();
        await new Promise((r) => b.child.once("exit", r));
        b = await start(url);
        const signed = await login(b.base, "Shared Technician", "777777");
        assert.equal(signed.user.id, worker.user.id);
        const row = await db.execute("SELECT hash FROM usuarios LIMIT 1");
        assert.match(row.rows[0].hash, /^p:310000:/);
      },
    );
  } finally {
    for (const s of [a, b]) {
      if (s?.child.exitCode === null) {
        s.child.kill();
        await new Promise((r) => s.child.once("exit", r));
      }
    }
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("first administrator is created from the app only once, without bootstrap variables", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "os-setup-"));
  const url = "file:" + path.join(dir, "central.db");
  let a;
  const db = createClient({ url });
  try {
    a = await start(url, false);
    const status = await (await call(a.base, "/api/auth/status")).json();
    assert.equal(status.hasUsers, false);
    assert.equal(
      (await call(a.base, "/api/auth/setup", { method: "POST", body: { nome: "X", pin: "12" } })).status,
      400,
    );
    const created = await call(a.base, "/api/auth/setup", {
      method: "POST",
      body: { nome: "Primeiro Admin", pin: "246810" },
    });
    assert.equal(created.status, 201);
    const session = await created.json();
    assert.equal(session.user.cargo, "Administrador");
    assert.ok(!JSON.stringify(session).includes("246810"));
    const me = await call(a.base, "/api/auth/me", { token: session.token });
    assert.equal(me.status, 200);
    // fechada para sempre: ninguém mais vira administrador por esta rota
    const closed = await call(a.base, "/api/auth/setup", {
      method: "POST",
      body: { nome: "Intruso", pin: "135790" },
    });
    assert.equal(closed.status, 409);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM usuarios")).rows[0].n, 1);
    // o administrador criado entra normalmente depois
    const signed = await login(a.base, "primeiro admin", "246810");
    assert.equal(signed.user.cargo, "Administrador");
  } finally {
    if (a?.child.exitCode === null) {
      a.child.kill();
      await new Promise((r) => a.child.once("exit", r));
    }
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
