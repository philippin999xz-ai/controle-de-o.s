// Armazenamento local do app pessoal (neste navegador). Usa as MESMAS chaves do app anterior:
// os_regs (registros), IndexedDB "os_fotos" (fotos) e os_tema. Nada do que já foi salvo se perde.
let activeAccount = "";
export const accountKey = () => activeAccount;
const scoped = new Set([
  "os_regs",
  "os_pend",
  "os_pend_foto",
  "os_apagados",
  "os_sync_desde",
]);
const keyFor = (k) =>
  activeAccount && scoped.has(k) ? "os_cloud_" + activeAccount + ":" + k : k;
const changed = () => window.dispatchEvent(new Event("os:records-changed"));
const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(keyFor(k));
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(keyFor(k), JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  },
};
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v, max) =>
  v == null
    ? ""
    : String(v)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .slice(0, max);
const iso = (v) => {
  const s = str(v, 40);
  return /^[0-9TZ:+.\- ]*$/.test(s) ? s : "";
};
const CAMPOS_REG = [
  "numero_os",
  "equipamento",
  "servico_solicitado",
  "executante",
  "tipo_manutencao",
  "observacoes",
];

export function limpaReg(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const id = String(r.id == null ? "" : r.id);
  if (!ID_RE.test(id)) return null;
  const o = { id };
  CAMPOS_REG.forEach((k) => {
    o[k] = str(r[k], 4000);
  });
  o.criado = iso(r.criado);
  o.usuario = str(r.usuario, 80); // sobra do app antigo; preservado, não usado
  o.usuario_id = ID_RE.test(String(r.usuario_id || ""))
    ? String(r.usuario_id)
    : "";
  o.foto = !!r.foto;
  if (r.editado) {
    o.editado = iso(r.editado);
    o.editado_por = str(r.editado_por, 80);
  }
  return o;
}
const lista = (v) => (Array.isArray(v) ? v : []);
export const regs = () =>
  lista(LS.get("os_regs", [])).map(limpaReg).filter(Boolean);
export const saveRegs = (r) =>
  LS.set("os_regs", r.map(limpaReg).filter(Boolean));

/* ---------- controle da sincronização na nuvem ---------- */
export const versao = (r) => r?.editado || r?.criado || ""; // "versão" de uma OS = data da última edição
const ids = (k) => {
  const v = LS.get(k, []);
  return Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && ID_RE.test(x))
    : [];
};
const addId = (k, id) => {
  const l = ids(k);
  if (!l.includes(id)) {
    l.push(id);
    LS.set(k, l);
  }
};
const delIds = (k, del) => {
  const d = new Set(del);
  LS.set(
    k,
    ids(k).filter((x) => !d.has(x)),
  );
};
export const pend = () => ids("os_pend"); // OS alteradas aqui, ainda não enviadas
export const pendFoto = () => ids("os_pend_foto"); // fotos novas ainda não enviadas
export const marcarPend = (id) => addId("os_pend", id);
export const marcarPendFoto = (id) => addId("os_pend_foto", id);
export const limparPend = (l) => delIds("os_pend", l);
export const limparPendFoto = (l) => delIds("os_pend_foto", l);
export const apagados = () => {
  const v = LS.get("os_apagados", []);
  return Array.isArray(v)
    ? v
        .filter((x) => x && ID_RE.test(String(x.id)) && typeof x.v === "string")
        .map((x) => ({ id: String(x.id), v: iso(x.v) }))
    : [];
};
export const limparApagados = (l) => {
  const d = new Set(l);
  LS.set(
    "os_apagados",
    apagados().filter((x) => !d.has(x.id)),
  );
};
export const getDesde = () => {
  const n = LS.get("os_sync_desde", null);
  return Number.isFinite(n) ? n : null;
};
export const setDesde = (n) => LS.set("os_sync_desde", n);
export const getToken = () => {
  try {
    return sessionStorage.getItem("os_cloud_session") || "";
  } catch {
    return "";
  }
};
export const setSessionToken = (t) => {
  try {
    t
      ? sessionStorage.setItem("os_cloud_session", t)
      : sessionStorage.removeItem("os_cloud_session");
  } catch {}
};
export const leaveAccount = () => {
  activeAccount = "";
};
export async function selectAccount(user) {
  activeAccount = user.id;
  const assertAccount = () => {
    if (activeAccount !== user.id)
      throw Error("A conta mudou durante a preparação do cache.");
  };
  const permissions = user.perms.slice().sort().join("|");
  const permissionsKey = "os_cloud_" + user.id + ":permissions";
  if (localStorage.getItem(permissionsKey) !== permissions) {
    setDesde(null);
    localStorage.setItem(permissionsKey, permissions);
  }
  // Existing local work is preserved and copied once into the central account's upload queue.
  const importedKey = "os_cloud_" + user.id + ":legacy-copied";
  if (!localStorage.getItem(importedKey)) {
    let old = [];
    try {
      old = JSON.parse(localStorage.getItem("os_regs") || "[]");
    } catch {}
    const legacyUsers = window.Core?.users() || [];
    const legacyId = legacyUsers.find(
      (u) => u.nome.toLowerCase() === user.nome.toLowerCase(),
    )?.id;
    const records = (Array.isArray(old) ? old : [])
      .map(limpaReg)
      .filter(
        (r) =>
          r &&
          (user.perms.includes("painel_admin") ||
            r.usuario_id === legacyId ||
            r.usuario === user.nome),
      );
    const map = new Map(regs().map((r) => [r.id, r]));
    for (const r of records) {
      if (!map.has(r.id)) {
        map.set(r.id, {
          ...r,
          usuario_id: r.usuario_id === legacyId ? user.id : r.usuario_id,
        });
        marcarPend(r.id);
        if (r.foto) {
          const blob = await legacyPhoto(r.id);
          assertAccount();
          if (blob) {
            await fotoPut(r.id, blob);
            marcarPendFoto(r.id);
          }
        }
      }
    }
    assertAccount();
    if (!saveRegs([...map.values()]))
      throw Error("Não foi possível preparar os dados locais para envio.");
    localStorage.setItem(importedKey, "1");
  }
}

/** Grava (cria ou atualiza) UMA OS e a marca para enviar à nuvem. */
export function salvarOS(o, fotoNova = false) {
  const rec = regs(),
    i = rec.findIndex((x) => x.id === o.id);
  if (i >= 0) rec[i] = o;
  else rec.unshift(o);
  if (!saveRegs(rec)) return false;
  marcarPend(o.id);
  if (fotoNova) marcarPendFoto(o.id);
  changed();
  return true;
}
/** Exclui UMA OS (e a foto) e registra a exclusão para a nuvem apagar também. */
export function excluirOS(id) {
  saveRegs(regs().filter((x) => x.id !== id));
  fotoDel(id);
  delIds("os_pend", [id]);
  delIds("os_pend_foto", [id]);
  LS.set("os_apagados", [
    ...apagados().filter((x) => x.id !== id),
    { id, v: new Date().toISOString() },
  ]);
  changed();
}

/* ---------- fotos (IndexedDB) ---------- */
let db = null;
const photoKey = (id) => (activeAccount ? activeAccount + ":" + id : id);
const dbReady = new Promise((r) => {
  try {
    const q = indexedDB.open("os_fotos", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("f");
    q.onsuccess = () => {
      db = q.result;
      r();
    };
    q.onerror = () => r();
  } catch {
    r();
  }
});
export const fotoPut = async (id, b) => {
  const key = photoKey(id);
  await dbReady;
  if (!db) throw new Error("IndexedDB indisponível");
  return new Promise((res, rej) => {
    try {
      const t = db.transaction("f", "readwrite");
      t.objectStore("f").put(b, key);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    } catch (e) {
      rej(e);
    }
  });
};
export const fotoGet = async (id) => {
  const key = photoKey(id);
  await dbReady;
  if (!db) return null;
  return new Promise((r) => {
    try {
      const q = db.transaction("f").objectStore("f").get(key);
      q.onsuccess = () => r(q.result || null);
      q.onerror = () => r(null);
    } catch {
      r(null);
    }
  });
};
export const fotoDel = async (id) => {
  const key = photoKey(id);
  await dbReady;
  if (!db) return;
  try {
    db.transaction("f", "readwrite").objectStore("f").delete(key);
  } catch {}
};

async function legacyPhoto(id) {
  await dbReady;
  if (!db) return null;
  return new Promise((r) => {
    const q = db.transaction("f").objectStore("f").get(id);
    q.onsuccess = () => r(q.result || null);
    q.onerror = () => r(null);
  });
}

/* ---------- tema claro/escuro ---------- */
function aplicarTema(t) {
  document.documentElement.setAttribute("data-theme", t);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = t === "light" ? "#ffffff" : "#000000";
}
export const iniciarTema = () => {
  let t = "dark";
  try {
    t = localStorage.getItem("os_tema") === "light" ? "light" : "dark";
  } catch {}
  aplicarTema(t);
};
export const alternarTema = () => {
  const n =
    document.documentElement.getAttribute("data-theme") === "light"
      ? "dark"
      : "light";
  try {
    localStorage.setItem("os_tema", n);
  } catch {}
  aplicarTema(n);
};

/* ---------- backup (para levar o histórico entre celular e PC) ---------- */
export const exportarBackup = () => ({
  app: "controle-os",
  versao: 3,
  exportado: new Date().toISOString(),
  os_regs: regs(),
});
export function importarBackup(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.os_regs))
    throw new Error("Arquivo de backup inválido.");
  const atual = regs(),
    porId = new Map(atual.map((r) => [r.id, r]));
  let novos = 0,
    atualizados = 0;
  const mexidos = [];
  for (const x of d.os_regs.slice(0, 50000)) {
    const r = limpaReg(x);
    if (!r) continue;
    const ex = porId.get(r.id);
    if (!ex) {
      porId.set(r.id, r);
      novos++;
      mexidos.push(r.id);
    } else if ((r.editado || "") > (ex.editado || "")) {
      porId.set(r.id, { ...r, foto: ex.foto || r.foto });
      atualizados++;
      mexidos.push(r.id);
    } // mantém a versão mais recente
  }
  const todos = [...porId.values()].sort((a, b) =>
    (b.criado || "").localeCompare(a.criado || ""),
  );
  if (!saveRegs(todos))
    throw new Error("Não consegui salvar (armazenamento cheio?).");
  mexidos.forEach(marcarPend);
  changed();
  return { novos, atualizados };
}
