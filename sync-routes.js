// Rotas de sincronização: /api/sync/*  (todas exigem a chave de acesso, via middleware)
import express from "express";
import { z } from "zod";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const S = (n) => z.string().max(n);

// Só os campos conhecidos de uma O.S.; qualquer outro campo é descartado.
const Dados = z.object({
  id: S(64), numero_os: S(4000), equipamento: S(4000), servico_solicitado: S(4000), executante: S(4000),
  tipo_manutencao: S(4000), observacoes: S(4000), criado: S(40), editado: S(40), editado_por: S(80),
  usuario: S(80), usuario_id: S(64), foto: z.boolean(),
}).partial();

const Item = z.object({
  id: z.string().regex(ID),
  v: S(40),                       // versão = data da última edição (ISO); vence a mais recente
  apagado: z.boolean().optional(),
  dados: Dados.optional(),
});
const Lote = z.object({ itens: z.array(Item).min(1).max(100) });

export function rotasSync(db) {
  const r = express.Router();

  // O.S. alteradas desde um instante (inclui as apagadas, para o outro aparelho também apagar)
  r.get("/os", async (req, res, next) => {
    try {
      const agora = Date.now();
      const desde = Math.max(0, Number.parseInt(String(req.query.desde ?? "0"), 10) || 0);
      const q = await db.execute({
        sql: "SELECT id, dados, v, apagado FROM os WHERE atualizado_em > ? ORDER BY atualizado_em LIMIT 5000",
        args: [desde],
      });
      const itens = q.rows.map((x) => ({ id: x.id, v: x.v, apagado: Number(x.apagado) === 1, dados: JSON.parse(x.dados) }));
      res.set("Cache-Control", "no-store").json({ agora, itens });
    } catch (e) { next(e); }
  });

  // Envia O.S. novas/editadas/apagadas. Em conflito vence a versão mais recente (v maior).
  r.post("/os", async (req, res, next) => {
    try {
      const p = Lote.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Dados de sincronização inválidos." } });
      const agora = Date.now();
      const stmts = [];
      for (const it of p.data.itens) {
        const apagado = it.apagado ? 1 : 0;
        const dados = JSON.stringify(apagado ? {} : { ...(it.dados || {}), id: it.id });
        stmts.push({
          sql: `INSERT INTO os (id, dados, v, apagado, atualizado_em) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET dados = excluded.dados, v = excluded.v, apagado = excluded.apagado, atualizado_em = excluded.atualizado_em
                WHERE excluded.v >= os.v`,
          args: [it.id, dados, it.v, apagado, agora],
        });
        if (apagado) stmts.push({ sql: "DELETE FROM fotos WHERE id = ? AND EXISTS (SELECT 1 FROM os WHERE id = ? AND apagado = 1)", args: [it.id, it.id] });
      }
      await db.batch(stmts, "write");
      res.json({ ok: true, recebidos: p.data.itens.length });
    } catch (e) { next(e); }
  });

  // Fotos (binário). Já vêm reduzidas do app (~200-400 KB).
  r.put("/foto/:id", express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "4mb" }), async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!ID.test(id) || !Buffer.isBuffer(req.body) || req.body.length < 100) {
        return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Foto inválida." } });
      }
      await db.execute({
        sql: `INSERT INTO fotos (id, mime, bytes, atualizado_em) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, atualizado_em = excluded.atualizado_em`,
        args: [id, String(req.headers["content-type"]).split(";")[0], req.body, Date.now()],
      });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.get("/foto/:id", async (req, res, next) => {
    try {
      if (!ID.test(req.params.id)) return res.status(400).end();
      const q = await db.execute({ sql: "SELECT mime, bytes FROM fotos WHERE id = ?", args: [req.params.id] });
      if (!q.rows.length) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Foto não encontrada." } });
      res.set({ "Content-Type": q.rows[0].mime, "Cache-Control": "private, max-age=86400" }).send(Buffer.from(q.rows[0].bytes));
    } catch (e) { next(e); }
  });

  return r;
}
