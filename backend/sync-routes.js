// Rotas de sincronização: /api/sync/*  (todas exigem a chave de acesso, via middleware)
import express from "express";
import { z } from "zod";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const S = (n) => z.string().max(n);

// Só os campos conhecidos de uma O.S.; qualquer outro campo é descartado.
const Dados = z
  .object({
    id: S(64),
    numero_os: S(4000),
    equipamento: S(4000),
    servico_solicitado: S(4000),
    executante: S(4000),
    tipo_manutencao: S(4000),
    observacoes: S(4000),
    criado: S(40),
    editado: S(40),
    editado_por: S(80),
    usuario: S(80),
    usuario_id: S(64),
    foto: z.boolean(),
  })
  .partial();

const Item = z.object({
  id: z.string().regex(ID),
  v: S(40), // versão = data da última edição (ISO); vence a mais recente
  apagado: z.boolean().optional(),
  dados: Dados.optional(),
});
const Lote = z.object({ itens: z.array(Item).min(1).max(100) });

// Recebe uma função que devolve o cliente atual do banco (ele pode reconectar durante a vida do servidor).
export function rotasSync(obterBanco) {
  const r = express.Router();
  const db = {
    execute: (...a) => obterBanco().execute(...a),
    batch: (...a) => obterBanco().batch(...a),
  };

  const can = (req, p) => req.user?.perms.includes(p);
  const deny = (res) =>
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Seu cargo não permite esta ação.",
      },
    });
  async function visiblePhoto(req) {
    const r = await db.execute({
      sql: "SELECT dados,apagado FROM os WHERE id=?",
      args: [req.params.id],
    });
    if (!r.rows.length || Number(r.rows[0].apagado)) return false;
    const record = JSON.parse(r.rows[0].dados);
    return can(req, "ver_historico") || record.usuario_id === req.user.id;
  }
  // O.S. alteradas desde um instante (inclui as apagadas, para o outro aparelho também apagar)
  r.get("/os", async (req, res, next) => {
    try {
      if (!can(req, "pesquisar") && !can(req, "ver_historico"))
        return deny(res);
      const agora = Date.now();
      const desde = Math.max(
        0,
        Number.parseInt(String(req.query.desde ?? "0"), 10) || 0,
      );
      const cursor = String(req.query.cursor || "");
      let afterTime = desde,
        afterId = "";
      if (cursor) {
        try {
          const decoded = JSON.parse(
            Buffer.from(cursor, "base64url").toString(),
          );
          if (
            !Array.isArray(decoded) ||
            decoded.length !== 2 ||
            !Number.isFinite(decoded[0]) ||
            typeof decoded[1] !== "string"
          )
            throw Error();
          [afterTime, afterId] = decoded;
        } catch {
          return res
            .status(400)
            .json({ error: { message: "Cursor inválido." } });
        }
      }
      const all = can(req, "ver_historico");
      const q = await db.execute({
        sql: `SELECT id,dados,v,apagado,atualizado_em FROM os WHERE (atualizado_em>? OR (atualizado_em=? AND id>?)) ${all ? "" : "AND (json_extract(dados,'$.usuario_id')=? OR apagado=1)"} ORDER BY atualizado_em,id LIMIT 501`,
        args: [afterTime, afterTime, afterId, ...(all ? [] : [req.user.id])],
      });
      const more = q.rows.length > 500;
      const rows = q.rows.slice(0, 500);
      const last = rows.at(-1);
      const proximo = more
        ? Buffer.from(
            JSON.stringify([Number(last.atualizado_em), last.id]),
          ).toString("base64url")
        : null;
      const itens = rows.map((x) => ({
        id: x.id,
        v: x.v,
        apagado: Number(x.apagado) === 1,
        dados: JSON.parse(x.dados),
      }));
      res.set("Cache-Control", "no-store").json({ agora, itens, proximo });
    } catch (e) {
      next(e);
    }
  });

  // Envia O.S. novas/editadas/apagadas. Em conflito vence a versão mais recente (v maior).
  r.post("/os", async (req, res, next) => {
    try {
      const p = Lote.safeParse(req.body);
      if (!p.success)
        return res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message: "Dados de sincronização inválidos.",
          },
        });
      const agora = Date.now();
      const stmts = [];
      for (const it of p.data.itens) {
        const stored = await db.execute({
          sql: "SELECT dados,v,apagado FROM os WHERE id=?",
          args: [it.id],
        });
        const old = stored.rows[0];
        if (old && it.v <= old.v) continue;
        const isAdmin = can(req, "painel_admin");
        if (it.apagado) {
          if (!can(req, "excluir_os")) return deny(res);
        } else if (old) {
          if (!can(req, "editar_os")) return deny(res);
        } else if (!can(req, "criar_os")) return deny(res);
        if (
          old &&
          !can(req, "ver_historico") &&
          JSON.parse(old.dados).usuario_id !== req.user.id
        )
          return deny(res);
        if (!it.apagado) {
          const prior = old ? JSON.parse(old.dados) : null;
          it.dados = {
            ...(it.dados || {}),
            usuario_id:
              prior?.usuario_id ||
              (isAdmin && it.dados?.usuario_id
                ? it.dados.usuario_id
                : req.user.id),
            usuario:
              prior?.usuario ||
              (isAdmin && it.dados?.usuario ? it.dados.usuario : req.user.nome),
            ...(old ? { editado_por: req.user.nome } : {}),
          };
        }
        const apagado = it.apagado ? 1 : 0;
        const dados = JSON.stringify(
          apagado ? {} : { ...(it.dados || {}), id: it.id },
        );
        stmts.push({
          sql: `INSERT INTO os (id, dados, v, apagado, atualizado_em) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET dados = excluded.dados, v = excluded.v, apagado = excluded.apagado, atualizado_em = excluded.atualizado_em
                WHERE excluded.v > os.v`,
          args: [it.id, dados, it.v, apagado, agora],
        });
        if (apagado)
          stmts.push({
            sql: "DELETE FROM fotos WHERE id = ? AND EXISTS (SELECT 1 FROM os WHERE id = ? AND apagado = 1)",
            args: [it.id, it.id],
          });
      }
      if (stmts.length) await db.batch(stmts, "write");
      res.json({ ok: true, recebidos: p.data.itens.length });
    } catch (e) {
      next(e);
    }
  });

  // Fotos (binário). Já vêm reduzidas do app (~200-400 KB).
  r.put(
    "/foto/:id",
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: "4mb",
    }),
    async (req, res, next) => {
      try {
        const id = req.params.id;
        if (
          !ID.test(id) ||
          !Buffer.isBuffer(req.body) ||
          req.body.length < 100
        ) {
          return res.status(400).json({
            error: { code: "INVALID_INPUT", message: "Foto inválida." },
          });
        }
        if (
          !(await visiblePhoto(req)) ||
          (!can(req, "criar_os") && !can(req, "editar_os"))
        )
          return deny(res);
        if (!can(req, "editar_os")) {
          const owner = await db.execute({
            sql: "SELECT json_extract(dados,'$.usuario_id') AS owner FROM os WHERE id=?",
            args: [id],
          });
          const existing = await db.execute({
            sql: "SELECT id FROM fotos WHERE id=?",
            args: [id],
          });
          if (owner.rows[0]?.owner !== req.user.id || existing.rows.length)
            return deny(res);
        }
        await db.execute({
          sql: `INSERT INTO fotos (id, mime, bytes, atualizado_em) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, atualizado_em = excluded.atualizado_em`,
          args: [
            id,
            String(req.headers["content-type"]).split(";")[0],
            req.body,
            Date.now(),
          ],
        });
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );

  r.get("/foto/:id", async (req, res, next) => {
    try {
      if (!ID.test(req.params.id)) return res.status(400).end();
      if (!(await visiblePhoto(req))) return deny(res);
      const q = await db.execute({
        sql: "SELECT mime, bytes FROM fotos WHERE id = ?",
        args: [req.params.id],
      });
      if (!q.rows.length)
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: "Foto não encontrada." },
        });
      res
        .set({
          "Content-Type": q.rows[0].mime,
          "Cache-Control": "private, max-age=86400",
        })
        .send(Buffer.from(q.rows[0].bytes));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
