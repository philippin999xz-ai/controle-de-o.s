// Banco na nuvem (Turso / libSQL = SQLite). Sem TURSO_DATABASE_URL o servidor roda sem sincronização.
// Em testes locais dá para usar TURSO_DATABASE_URL=file:/tmp/teste.db
import { createClient } from "@libsql/client";

export async function abrirBanco() {
  const url = (process.env.TURSO_DATABASE_URL || "").trim();
  if (!url) return null;
  const db = createClient({ url, authToken: (process.env.TURSO_AUTH_TOKEN || "").trim() || undefined });
  await db.batch([
    `CREATE TABLE IF NOT EXISTS os (
       id TEXT PRIMARY KEY,
       dados TEXT NOT NULL,
       v TEXT NOT NULL DEFAULT '',
       apagado INTEGER NOT NULL DEFAULT 0,
       atualizado_em INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS os_atualizado ON os(atualizado_em)`,
    `CREATE TABLE IF NOT EXISTS fotos (
       id TEXT PRIMARY KEY,
       mime TEXT NOT NULL,
       bytes BLOB NOT NULL,
       atualizado_em INTEGER NOT NULL
     )`,
  ], "write");
  return db;
}
