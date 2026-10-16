// O login central autoriza o envio; nenhum segredo do Render é copiado para o navegador.
import { req } from "./api.js";
import * as S from "./store.js";
let rodando = null,
  contexto = "";
export const configurado = () => !!S.getToken();
export const resetarAuth = () => {};
class ErroSync extends Error {}
async function chamar(path, opts, ms) {
  const r = await req(path, opts, ms);
  if (r.ok) return r;
  const j = await r.json().catch(() => ({}));
  throw new ErroSync(
    j?.error?.message ||
      (r.status === 401
        ? "Entre novamente para sincronizar."
        : `Falha na sincronização [HTTP ${r.status}].`),
  );
}
export function sincronizar() {
  if (!configurado())
    return Promise.resolve({
      ok: false,
      off: true,
      msg: "Entre com seu usuário.",
    });
  const id = S.accountKey();
  if (rodando)
    return contexto === id ? rodando : rodando.then(() => sincronizar());
  contexto = id;
  rodando = (async () => {
    let result;
    const token = S.getToken();
    for (let n = 0; n < 3; n++) {
      result = await sincronizarConta(id, token);
      if (!S.pend().length && !S.pendFoto().length && !S.apagados().length)
        return result;
    }
    return { ...result, ok: false, pending: true };
  })()
    .catch((e) => ({
      ok: false,
      msg:
        e instanceof ErroSync
          ? e.message
          : e.name === "AbortError"
            ? "O servidor demorou demais. O envio será repetido automaticamente."
            : "Não foi possível conectar. As alterações aguardam envio automático.",
    }))
    .finally(() => {
      rodando = null;
    });
  return rodando;
}
async function sincronizarConta(account, token) {
  const assertAccount = () => {
    if (S.accountKey() !== account || S.getToken() !== token)
      throw new ErroSync("A conta mudou durante a sincronização.");
  };
  const wait = async (p) => {
    const result = await p;
    assertAccount();
    return result;
  };
  const desde = S.getDesde();
  const mapa = new Map(S.regs().map((r) => [r.id, r]));
  const pend = S.pend();
  S.limparPend(pend.filter((id) => !mapa.has(id)));
  const itens = [
    ...pend
      .filter((id) => mapa.has(id))
      .map((id) => ({ id, v: S.versao(mapa.get(id)), dados: mapa.get(id) })),
    ...S.apagados().map((r) => ({ ...r, apagado: true })),
  ];
  for (let i = 0; i < itens.length; i += 100) {
    const lote = itens.slice(i, i + 100);
    await wait(
      chamar(
        "/api/sync/os",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itens: lote }),
        },
        30000,
      ),
    );
    const current = new Map(S.regs().map((r) => [r.id, r]));
    const deleted = new Map(S.apagados().map((r) => [r.id, r.v]));
    S.limparPend(
      lote
        .filter((x) => !x.apagado && S.versao(current.get(x.id)) === x.v)
        .map((x) => x.id),
    );
    S.limparApagados(
      lote
        .filter((x) => x.apagado && deleted.get(x.id) === x.v)
        .map((x) => x.id),
    );
  }
  for (const id of S.pendFoto()) {
    const version = S.versao(S.regs().find((r) => r.id === id));
    const blob = await wait(S.fotoGet(id));
    if (!blob) {
      S.limparPendFoto([id]);
      continue;
    }
    await wait(
      chamar(
        "/api/sync/foto/" + encodeURIComponent(id),
        {
          method: "PUT",
          headers: { "Content-Type": blob.type || "image/jpeg" },
          body: blob,
        },
        60000,
      ),
    );
    if (S.versao(S.regs().find((r) => r.id === id)) === version)
      S.limparPendFoto([id]);
  }
  let cursor = null,
    agora = Date.now(),
    mudou = false;
  do {
    const response = await wait(
      chamar(
        "/api/sync/os?desde=" +
          (desde ?? 0) +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        {},
        30000,
      ),
    );
    const page = await wait(response.json());
    if (!Array.isArray(page.itens) || !Number.isFinite(page.agora))
      throw new ErroSync("Resposta de sincronização inválida.");
    const local = new Map(S.regs().map((r) => [r.id, r])),
      deleted = new Map(S.apagados().map((r) => [r.id, r.v]));
    for (const it of page.itens) {
      const old = local.get(it.id);
      if (it.apagado) {
        if (old && S.versao(old) <= it.v) {
          local.delete(it.id);
          S.fotoDel(it.id);
          mudou = true;
        }
      } else {
        const row = S.limpaReg(it.dados);
        if (!row || deleted.get(row.id) >= S.versao(row)) continue;
        if (
          !old ||
          S.versao(old) < S.versao(row) ||
          (S.versao(old) === S.versao(row) &&
            !S.pend().includes(row.id) &&
            JSON.stringify(old) !== JSON.stringify(row))
        ) {
          if (
            old &&
            S.versao(old) < S.versao(row) &&
            !S.pendFoto().includes(row.id)
          )
            S.fotoDel(row.id);
          local.set(row.id, row);
          mudou = true;
        }
      }
    }
    if (
      !S.saveRegs(
        [...local.values()].sort((a, b) =>
          (b.criado || "").localeCompare(a.criado || ""),
        ),
      )
    )
      throw new ErroSync(
        "Não foi possível atualizar a cópia deste aparelho. Libere espaço e tente novamente.",
      );
    agora = Math.min(agora, page.agora);
    cursor = page.proximo || null;
  } while (cursor);
  S.setDesde(Math.max(0, agora - 5000));
  return { ok: true, mudou };
}
export async function obterFoto(id) {
  const account = S.accountKey();
  const blob = await S.fotoGet(id);
  if (blob || !configurado()) return blob;
  try {
    const r = await req("/api/sync/foto/" + encodeURIComponent(id), {}, 20000);
    if (!r.ok || S.accountKey() !== account) return null;
    const b = await r.blob();
    if (S.accountKey() !== account) return null;
    await S.fotoPut(id, b);
    return b;
  } catch {
    return null;
  }
}
