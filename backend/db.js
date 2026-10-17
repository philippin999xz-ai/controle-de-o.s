// Banco na nuvem (Turso / libSQL = SQLite). Sem TURSO_DATABASE_URL o servidor roda sem sincronização.
// Em testes locais dá para usar TURSO_DATABASE_URL=file:/tmp/teste.db
//
// Pontos que costumam quebrar a ligação Render <-> Turso e que são tratados aqui:
//  - o servidor NÃO espera o banco para abrir a porta (o Render derruba o deploy se a porta demorar);
//  - cada tentativa tem tempo limite e há novas tentativas em segundo plano;
//  - se o banco estiver fora quando o app pedir sincronização, tenta reconectar na hora;
//  - valores colados no painel do Render com aspas/espaço/quebra de linha são limpos;
//  - libsql:// vira https:// (HTTP é mais estável que WebSocket em hospedagem gratuita).
import { createClient } from "@libsql/client";

const limpa = (v) =>
  String(v ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

export function lerConfigBanco(env = process.env) {
  const original = limpa(env.TURSO_DATABASE_URL);
  const token = limpa(env.TURSO_AUTH_TOKEN);
  const remoto = /^(libsql|https?|wss?):\/\//i.test(original);
  const problemas = [];
  if (original && !remoto && !/^file:/i.test(original))
    problemas.push("TURSO_DATABASE_URL deve começar com libsql://");
  if (original && remoto && !token) problemas.push("falta TURSO_AUTH_TOKEN");
  return {
    configurado: Boolean(original) && problemas.length === 0,
    url: original.replace(/^libsql:\/\//i, "https://"),
    token,
    problemas,
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pesquisas_diagnostico(id TEXT PRIMARY KEY,usuario_id TEXT NOT NULL,equipamento TEXT NOT NULL,codigo TEXT NOT NULL,sintoma TEXT NOT NULL,resultado TEXT NOT NULL,criado_em TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pesquisas_usuario_data ON pesquisas_diagnostico(usuario_id,criado_em DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS cargos(nome TEXT PRIMARY KEY,nivel INTEGER NOT NULL,fixo INTEGER NOT NULL DEFAULT 0,perms TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS usuarios(id TEXT PRIMARY KEY,nome TEXT NOT NULL,nome_normalizado TEXT NOT NULL UNIQUE,cargo TEXT NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,ativo INTEGER NOT NULL DEFAULT 1,criado TEXT NOT NULL,tentativas INTEGER NOT NULL DEFAULT 0,bloqueado_ate INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessoes(token_hash TEXT PRIMARY KEY,usuario_id TEXT NOT NULL,expira_em INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessoes_usuario ON sessoes(usuario_id)`,
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
];

// Traduz o erro técnico do Turso para uma frase que ajude a achar a causa (sem vazar URL/token).
export function motivoErro(e) {
  const m = String(e?.message || e || "");
  if (/timeout|tempo esgotado/i.test(m))
    return "Tempo esgotado falando com o Turso (rede lenta ou banco indisponível).";
  if (/\b401\b|unauthori|auth|jwt|token/i.test(m))
    return "O Turso recusou o token: confira TURSO_AUTH_TOKEN (válido, não expirado e do MESMO banco da URL).";
  if (/\b404\b|not found|no such database/i.test(m))
    return "O Turso não encontrou o banco: confira TURSO_DATABASE_URL.";
  if (/ENOTFOUND|EAI_AGAIN/i.test(m))
    return "Não foi possível resolver o endereço do Turso: confira TURSO_DATABASE_URL.";
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network|socket/i.test(m))
    return "Sem conexão com o Turso (falha de rede).";
  return "Falha ao falar com o Turso: " + m.slice(0, 160);
}

const comTempo = (p, ms) =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("tempo esgotado")), ms),
    ),
  ]);

let cliente = null;
let conectando = null;
const estado = { configurado: false, ok: false, erro: null, tentativas: 0 };

export const obterBanco = () => (estado.ok ? cliente : null);
export const estadoBanco = () => ({ ...estado });

async function tentar(cfg) {
  estado.tentativas += 1;
  try {
    if (!cliente)
      cliente = createClient({
        url: cfg.url,
        authToken: cfg.token || undefined,
      });
    await comTempo(cliente.batch(SCHEMA, "write"), 20_000);
    estado.ok = true;
    estado.erro = null;
    return true;
  } catch (e) {
    estado.ok = false;
    estado.erro = motivoErro(e);
    console.error(
      `[banco] tentativa ${estado.tentativas} falhou: ${estado.erro}`,
    );
    try {
      cliente?.close?.();
    } catch {
      /* ignora */
    }
    cliente = null; // recria o cliente na próxima tentativa
    return false;
  }
}

/** Conecta e cria as tabelas, com novas tentativas. Nunca lança erro e nunca derruba o servidor. */
export function conectarBanco({ tentativas = 6 } = {}) {
  if (conectando) return conectando;
  const cfg = lerConfigBanco();
  estado.configurado = cfg.configurado;
  if (!cfg.configurado) {
    estado.ok = false;
    estado.erro =
      cfg.problemas.join("; ") || "Turso não configurado (TURSO_DATABASE_URL).";
    console.warn("[banco]", estado.erro);
    return Promise.resolve(false);
  }
  conectando = (async () => {
    for (let i = 1; i <= tentativas; i++) {
      if (await tentar(cfg)) {
        console.log("[banco] Turso conectado.");
        return true;
      }
      if (i < tentativas) await dorme(Math.min(2000 * i, 10_000));
    }
    return false;
  })().finally(() => {
    conectando = null;
  });
  return conectando;
}

/** Garante que o banco está pronto (reconecta uma vez, rápido, se estiver fora). */
export async function garantirBanco() {
  if (estado.ok && cliente) return true;
  if (!lerConfigBanco().configurado) return false;
  return conectarBanco({ tentativas: 1 });
}
