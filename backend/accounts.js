import express from "express";
import {
  randomBytes,
  randomUUID,
  pbkdf2 as derive,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
const pbkdf2 = promisify(derive),
  IT = 310000;
const PERMS = [
  "criar_os",
  "usar_ia",
  "pesquisar",
  "ver_historico",
  "editar_os",
  "excluir_os",
  "exportar",
  "dashboard",
  "consultar_ia",
  "painel_admin",
  "perguntar_ia",
  "consultar_manuais",
];
const defaults = [
  [
    "Estagiário",
    1,
    ["criar_os", "usar_ia", "pesquisar", "perguntar_ia", "consultar_manuais"],
  ],
  [
    "Técnico",
    2,
    [
      "criar_os",
      "usar_ia",
      "pesquisar",
      "ver_historico",
      "exportar",
      "perguntar_ia",
      "consultar_manuais",
    ],
  ],
  [
    "Supervisor",
    3,
    [
      "criar_os",
      "usar_ia",
      "pesquisar",
      "ver_historico",
      "editar_os",
      "exportar",
      "dashboard",
      "perguntar_ia",
      "consultar_manuais",
    ],
  ],
  ["Administrador", 99, PERMS],
];
function cyrb(s) {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

const norm = (s) => s.trim().toLocaleLowerCase("pt-BR");
const digest = (s) => createHash("sha256").update(s).digest("hex");
const same = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const publicUser = (u) => ({
  id: u.id,
  nome: u.nome,
  cargo: u.cargo,
  ativo: !!u.ativo,
  criado: u.criado,
});
const publicRole = (r) => ({
  nome: r.nome,
  nivel: r.nivel,
  fixo: !!r.fixo,
  perms: JSON.parse(r.perms),
});
async function credentials(pin) {
  const salt = randomBytes(12).toString("hex");
  return {
    salt,
    hash:
      `p:${IT}:` +
      (await pbkdf2(pin, "os-pin:" + salt, IT, 32, "sha256")).toString("hex"),
  };
}
async function verify(u, pin) {
  const [type, it] = u.hash.split(":");
  if (type === "p") {
    const rounds = Number(it);
    if (rounds < 1000 || rounds > 5000000) return false;
    return same(
      u.hash,
      `p:${rounds}:` +
        (await pbkdf2(pin, "os-pin:" + u.salt, rounds, 32, "sha256")).toString(
          "hex",
        ),
    );
  }
  if (type === "s") return same(u.hash, "s:" + digest(u.salt + ":" + pin));
  if (type === "c") return same(u.hash, "c:" + cyrb(u.salt + ":" + pin));
  return false;
}
const loginSchema = z
  .object({
    nome: z.string().trim().min(1).max(60),
    pin: z.string().regex(/^\d{4,8}$/),
  })
  .strict();
const userSchema = loginSchema.extend({ cargo: z.string().min(1).max(60) });
const roleSchema = z
  .object({
    nome: z.string().trim().min(1).max(60),
    nivel: z.number().int().min(1).max(98),
    perms: z.array(z.enum(PERMS)).max(PERMS.length),
  })
  .strict();
export function accounts({ db, ready, adminName = "", adminPin = "" }) {
  let preparing = null,
    initializedClient = null;
  async function initialize() {
    if (initializedClient && db() === initializedClient) return true;
    if (preparing) return preparing;
    preparing = (async () => {
      if (!(await ready())) return false;
      const tx = await db().transaction("write");
      try {
        for (const [nome, nivel, perms] of defaults)
          await tx.execute({
            sql: "INSERT OR IGNORE INTO cargos(nome,nivel,fixo,perms) VALUES(?,?,?,?)",
            args: [nome, nivel, nivel === 99 ? 1 : 0, JSON.stringify(perms)],
          });
        const count = await tx.execute("SELECT COUNT(*) AS n FROM usuarios");
        if (
          !Number(count.rows[0].n) &&
          adminName.trim() &&
          /^\d{4,8}$/.test(adminPin)
        ) {
          const c = await credentials(adminPin);
          await tx.execute({
            sql: "INSERT INTO usuarios(id,nome,nome_normalizado,cargo,salt,hash,ativo,criado) VALUES(?,?,?,?,?,?,1,?)",
            args: [
              randomUUID(),
              adminName.trim(),
              norm(adminName),
              "Administrador",
              c.salt,
              c.hash,
              new Date().toISOString(),
            ],
          });
        }
        await tx.commit();
        initializedClient = db();
        return true;
      } catch (e) {
        await tx.rollback();
        throw e;
      } finally {
        tx.close();
      }
    })().finally(() => {
      preparing = null;
    });
    return preparing;
  }
  async function database(req, res, next) {
    try {
      if (!(await initialize()))
        return res.status(503).json({
          error: {
            code: "DB_UNAVAILABLE",
            message:
              "O banco central está indisponível. Confira a configuração do Turso no Render.",
          },
        });
      next();
    } catch {
      res.status(503).json({
        error: {
          code: "DB_UNAVAILABLE",
          message: "Não foi possível acessar os cadastros centrais.",
        },
      });
    }
  }
  const router = express.Router();
  router.use(database);
  router.get("/status", async (req, res) => {
    const result = await db().execute("SELECT COUNT(*) AS n FROM usuarios");
    res
      .set("Cache-Control", "no-store")
      .json({ central: true, hasUsers: Number(result.rows[0].n) > 0 });
  });
  // Primeiro acesso: cria o administrador direto pelo app, SOMENTE enquanto não existir nenhum usuário.
  // A checagem e a inserção ocorrem na mesma transação de escrita: duas pessoas ao mesmo tempo não
  // criam dois administradores, e depois do primeiro usuário esta rota fica fechada (409) para sempre.
  router.post("/setup", async (req, res) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({
        error: { message: "Informe o nome e um PIN de 4 a 8 números." },
      });
    const c = await credentials(p.data.pin);
    const id = randomUUID();
    const tx = await db().transaction("write");
    try {
      const count = await tx.execute("SELECT COUNT(*) AS n FROM usuarios");
      if (Number(count.rows[0].n) > 0) {
        await tx.rollback();
        return res.status(409).json({
          error: {
            code: "SETUP_CLOSED",
            message:
              "O primeiro administrador já foi criado. Entre com seu usuário e PIN.",
          },
        });
      }
      await tx.execute({
        sql: "INSERT INTO usuarios(id,nome,nome_normalizado,cargo,salt,hash,ativo,criado) VALUES(?,?,?,?,?,?,1,?)",
        args: [
          id,
          p.data.nome,
          norm(p.data.nome),
          "Administrador",
          c.salt,
          c.hash,
          new Date().toISOString(),
        ],
      });
      await tx.commit();
    } catch (e) {
      try {
        await tx.rollback();
      } catch {}
      throw e;
    } finally {
      tx.close();
    }
    const token = randomBytes(32).toString("hex");
    await db().execute({
      sql: "INSERT INTO sessoes(token_hash,usuario_id,expira_em) VALUES(?,?,?)",
      args: [digest(token), id, Date.now() + 8 * 3600000],
    });
    const user = {
      id,
      nome: p.data.nome,
      cargo: "Administrador",
      ativo: true,
      criado: new Date().toISOString(),
      perms: PERMS,
      nivel: 99,
    };
    res
      .status(201)
      .set("Cache-Control", "no-store")
      .json({ token, ...(await snapshot(user)) });
  });
  async function session(req, res, next) {
    try {
      const token = /^Bearer\s+([a-f0-9]{64})$/i.exec(
        req.headers.authorization || "",
      )?.[1];
      if (!token)
        return res.status(401).json({
          error: {
            code: "SESSION_REQUIRED",
            message: "Entre com seu usuário para continuar.",
          },
        });
      const r = await db().execute({
        sql: "SELECT u.*,c.perms,c.nivel FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id JOIN cargos c ON c.nome=u.cargo WHERE s.token_hash=? AND s.expira_em>? AND u.ativo=1",
        args: [digest(token), Date.now()],
      });
      if (!r.rows.length)
        return res.status(401).json({
          error: {
            code: "SESSION_EXPIRED",
            message: "Sua sessão terminou. Entre novamente.",
          },
        });
      req.user = {
        ...publicUser(r.rows[0]),
        perms: JSON.parse(r.rows[0].perms),
        nivel: r.rows[0].nivel,
      };
      req.sessionHash = digest(token);
      next();
    } catch {
      res.status(503).json({
        error: {
          code: "SESSION_UNAVAILABLE",
          message: "Não foi possível validar sua sessão no servidor.",
        },
      });
    }
  }
  const need = (permission) => (req, res, next) =>
    req.user?.perms.includes(permission)
      ? next()
      : res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Seu cargo não permite esta ação.",
          },
        });
  async function snapshot(user) {
    const roles = (
      await db().execute("SELECT * FROM cargos ORDER BY nivel DESC")
    ).rows.map(publicRole);
    const users = user.perms.includes("painel_admin")
      ? (
          await db().execute(
            "SELECT id,nome,cargo,ativo,criado FROM usuarios ORDER BY nome",
          )
        ).rows.map(publicUser)
      : [user];
    return { user, roles, users };
  }
  router.post("/login", async (req, res) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({
        error: { message: "Informe o nome e um PIN de 4 a 8 números." },
      });
    const name = norm(p.data.nome),
      r = await db().execute({
        sql: "SELECT * FROM usuarios WHERE nome_normalizado=?",
        args: [name],
      });
    const u = r.rows[0];
    if (u?.bloqueado_ate > Date.now())
      return res
        .status(429)
        .json({ error: { message: "Muitas tentativas. Aguarde 15 minutos." } });
    if (!u || !u.ativo || !(await verify(u, p.data.pin))) {
      if (u)
        await db().execute({
          sql: "UPDATE usuarios SET tentativas=tentativas+1,bloqueado_ate=CASE WHEN tentativas>=4 THEN ? ELSE bloqueado_ate END WHERE id=?",
          args: [Date.now() + 900000, u.id],
        });
      return res
        .status(401)
        .json({ error: { message: "Usuário ou PIN inválidos." } });
    }
    if (!u.hash.startsWith("p:")) {
      const upgraded = await credentials(p.data.pin);
      await db().execute({
        sql: "UPDATE usuarios SET salt=?,hash=? WHERE id=?",
        args: [upgraded.salt, upgraded.hash, u.id],
      });
    }
    const token = randomBytes(32).toString("hex");
    await db().batch(
      [
        {
          sql: "UPDATE usuarios SET tentativas=0,bloqueado_ate=0 WHERE id=?",
          args: [u.id],
        },
        { sql: "DELETE FROM sessoes WHERE expira_em<?", args: [Date.now()] },
        {
          sql: "INSERT INTO sessoes(token_hash,usuario_id,expira_em) VALUES(?,?,?)",
          args: [digest(token), u.id, Date.now() + 8 * 3600000],
        },
      ],
      "write",
    );
    const role = await db().execute({
      sql: "SELECT * FROM cargos WHERE nome=?",
      args: [u.cargo],
    });
    const user = {
      ...publicUser(u),
      perms: JSON.parse(role.rows[0].perms),
      nivel: role.rows[0].nivel,
    };
    res
      .set("Cache-Control", "no-store")
      .json({ token, ...(await snapshot(user)) });
  });
  router.use(session);
  router.get("/me", async (req, res) =>
    res.set("Cache-Control", "no-store").json(await snapshot(req.user)),
  );
  router.post("/logout", async (req, res) => {
    await db().execute({
      sql: "DELETE FROM sessoes WHERE token_hash=?",
      args: [req.sessionHash],
    });
    res.json({ ok: true });
  });
  router.use(need("painel_admin"));
  router.post("/users", async (req, res) => {
    const p = userSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({
        error: { message: "Confira nome, cargo e PIN (4 a 8 números)." },
      });
    const u = p.data;
    const role = await db().execute({
      sql: "SELECT nome FROM cargos WHERE nome=?",
      args: [u.cargo],
    });
    if (!role.rows.length)
      return res.status(400).json({ error: { message: "Cargo inválido." } });
    const c = await credentials(u.pin);
    try {
      await db().execute({
        sql: "INSERT INTO usuarios(id,nome,nome_normalizado,cargo,salt,hash,ativo,criado) VALUES(?,?,?,?,?,?,1,?)",
        args: [
          randomUUID(),
          u.nome,
          norm(u.nome),
          u.cargo,
          c.salt,
          c.hash,
          new Date().toISOString(),
        ],
      });
      res.status(201).json({ ok: true });
    } catch (e) {
      if (/unique/i.test(e.message))
        return res
          .status(409)
          .json({ error: { message: "Já existe um usuário com esse nome." } });
      throw e;
    }
  });
  const updateSchema = z
    .object({
      nome: z.string().trim().min(1).max(60),
      cargo: z.string().min(1).max(60),
      ativo: z.boolean(),
      pin: z
        .string()
        .regex(/^\d{4,8}$/)
        .optional(),
    })
    .strict();
  async function keepAdmin(tx) {
    const r = await tx.execute(
      "SELECT COUNT(*) AS n FROM usuarios u JOIN cargos c ON c.nome=u.cargo WHERE u.ativo=1 AND EXISTS(SELECT 1 FROM json_each(c.perms) WHERE value='painel_admin')",
    );
    if (!Number(r.rows[0].n))
      throw Error("Mantenha pelo menos um administrador ativo.");
  }
  router.put("/users/:id", async (req, res) => {
    const p = updateSchema.safeParse(req.body);
    if (!p.success)
      return res
        .status(400)
        .json({ error: { message: "Dados do usuário inválidos." } });
    if (req.params.id === req.user.id && !p.data.ativo)
      return res.status(400).json({
        error: { message: "Você não pode desativar a própria conta." },
      });
    const tx = await db().transaction("write");
    try {
      const u = p.data;
      const role = await tx.execute({
        sql: "SELECT nome FROM cargos WHERE nome=?",
        args: [u.cargo],
      });
      if (!role.rows.length) throw Error("Cargo inválido.");
      await tx.execute({
        sql: "UPDATE usuarios SET nome=?,nome_normalizado=?,cargo=?,ativo=? WHERE id=?",
        args: [u.nome, norm(u.nome), u.cargo, u.ativo ? 1 : 0, req.params.id],
      });
      await keepAdmin(tx);
      if (u.pin) {
        const c = await credentials(u.pin);
        await tx.execute({
          sql: "UPDATE usuarios SET salt=?,hash=?,tentativas=0,bloqueado_ate=0 WHERE id=?",
          args: [c.salt, c.hash, req.params.id],
        });
        await tx.execute({
          sql: "DELETE FROM sessoes WHERE usuario_id=?",
          args: [req.params.id],
        });
      }
      await tx.commit();
      res.json({ ok: true });
    } catch (e) {
      await tx.rollback();
      res.status(400).json({
        error: {
          message: /unique/i.test(e.message)
            ? "Já existe um usuário com esse nome."
            : e.message,
        },
      });
    } finally {
      tx.close();
    }
  });
  router.delete("/users/:id", async (req, res) => {
    if (req.params.id === req.user.id)
      return res
        .status(400)
        .json({ error: { message: "Você não pode excluir a própria conta." } });
    const tx = await db().transaction("write");
    try {
      await tx.execute({
        sql: "DELETE FROM usuarios WHERE id=?",
        args: [req.params.id],
      });
      await keepAdmin(tx);
      await tx.execute({
        sql: "DELETE FROM sessoes WHERE usuario_id=?",
        args: [req.params.id],
      });
      await tx.commit();
      res.json({ ok: true });
    } catch (e) {
      await tx.rollback();
      res.status(400).json({ error: { message: e.message } });
    } finally {
      tx.close();
    }
  });
  router.post("/roles", async (req, res) => {
    const p = roleSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ error: { message: "Cargo inválido." } });
    try {
      await db().execute({
        sql: "INSERT INTO cargos(nome,nivel,fixo,perms) VALUES(?,?,0,?)",
        args: [
          p.data.nome,
          p.data.nivel,
          JSON.stringify([...new Set(p.data.perms)]),
        ],
      });
      res.json({ ok: true });
    } catch {
      res
        .status(409)
        .json({ error: { message: "Já existe um cargo com esse nome." } });
    }
  });
  router.put("/roles/:name", async (req, res) => {
    const p = roleSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ error: { message: "Cargo inválido." } });
    const tx = await db().transaction("write");
    try {
      const current = await tx.execute({
        sql: "SELECT * FROM cargos WHERE nome=?",
        args: [req.params.name],
      });
      if (!current.rows.length || current.rows[0].fixo)
        throw Error("Este cargo não pode ser alterado.");
      await tx.execute({
        sql: "UPDATE cargos SET nome=?,nivel=?,perms=? WHERE nome=?",
        args: [
          p.data.nome,
          p.data.nivel,
          JSON.stringify(p.data.perms),
          req.params.name,
        ],
      });
      await tx.execute({
        sql: "UPDATE usuarios SET cargo=? WHERE cargo=?",
        args: [p.data.nome, req.params.name],
      });
      await keepAdmin(tx);
      await tx.commit();
      res.json({ ok: true });
    } catch (e) {
      await tx.rollback();
      res.status(400).json({
        error: {
          message: /unique/i.test(e.message)
            ? "Cargo já existente."
            : e.message,
        },
      });
    } finally {
      tx.close();
    }
  });
  router.delete("/roles/:name", async (req, res) => {
    const tx = await db().transaction("write");
    try {
      const r = await tx.execute({
          sql: "SELECT fixo FROM cargos WHERE nome=?",
          args: [req.params.name],
        }),
        used = await tx.execute({
          sql: "SELECT COUNT(*) AS n FROM usuarios WHERE cargo=?",
          args: [req.params.name],
        });
      if (r.rows[0]?.fixo || Number(used.rows[0].n))
        throw Error("Não é possível excluir um cargo fixo ou com usuários.");
      await tx.execute({
        sql: "DELETE FROM cargos WHERE nome=?",
        args: [req.params.name],
      });
      await tx.commit();
      res.json({ ok: true });
    } catch (e) {
      await tx.rollback();
      res.status(400).json({ error: { message: e.message } });
    } finally {
      tx.close();
    }
  });
  // One authenticated administrator can preserve compatible legacy PIN hashes. Never trust client sessions.
  router.get("/backup", async (req, res) => {
    const [os, users, roles] = await Promise.all([
      db().execute("SELECT dados FROM os WHERE apagado=0"),
      db().execute("SELECT id,nome,cargo,salt,hash,ativo,criado FROM usuarios"),
      db().execute("SELECT * FROM cargos"),
    ]);
    res.set("Cache-Control", "no-store").json({
      versao: 4,
      exportado: new Date().toISOString(),
      os_regs: os.rows.map((r) => JSON.parse(r.dados)),
      os_users: users.rows.map((u) => ({ ...u, ativo: !!u.ativo })),
      os_cargos: roles.rows.map(publicRole),
    });
  });
  router.post("/migrate", async (req, res) => {
    const parsed = z
      .object({
        users: z
          .array(
            z.object({
              id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
              nome: z.string().trim().min(1).max(60),
              cargo: z.string().max(60),
              salt: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
              hash: z
                .string()
                .regex(
                  /^(p:\d{4,7}:[a-f0-9]{64}|s:[a-f0-9]{64}|c:[a-f0-9]{4,32})$/,
                ),
              ativo: z.boolean(),
              criado: z.string().max(40),
            }),
          )
          .max(500),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: {
          message:
            "Cadastros legados inválidos. PINs antigos incompatíveis precisam ser redefinidos.",
        },
      });
    const tx = await db().transaction("write");
    let n = 0;
    try {
      for (const u of parsed.data.users) {
        const role = await tx.execute({
          sql: "SELECT nome FROM cargos WHERE nome=?",
          args: [u.cargo],
        });
        const r = await tx.execute({
          sql: "INSERT OR IGNORE INTO usuarios(id,nome,nome_normalizado,cargo,salt,hash,ativo,criado) VALUES(?,?,?,?,?,?,?,?)",
          args: [
            u.id,
            u.nome,
            norm(u.nome),
            role.rows.length ? u.cargo : "Estagiário",
            u.salt,
            u.hash,
            u.ativo ? 1 : 0,
            u.criado,
          ],
        });
        n += r.rowsAffected;
      }
      await tx.commit();
      res.json({ ok: true, importados: n });
    } catch {
      await tx.rollback();
      res
        .status(400)
        .json({ error: { message: "Não foi possível migrar os usuários." } });
    } finally {
      tx.close();
    }
  });
  return { router, initialize, session, database, need };
}
