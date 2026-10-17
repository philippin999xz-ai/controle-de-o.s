import { useEffect, useState } from "react";
import { req } from "./api.js";
import * as S from "./store.js";
let state = {
    user: null,
    users: [],
    roles: [],
    ready: false,
    hasUsers: true,
    error: "",
  },
  loading = null;
let generation = 0;
const emit = () => window.dispatchEvent(new Event("os:account"));
export async function accountRequest(path, method = "GET", body) {
  const r = await req(
    "/api/auth" + path,
    {
      method,
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    },
    20000,
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Object.assign(
      Error(data?.error?.message || "Não foi possível acessar o servidor."),
      { status: r.status },
    );
  }
  return data;
}
export async function refreshAccount() {
  if (loading) return loading;
  const version = generation;
  loading = (async () => {
    try {
      if (S.getToken()) {
        const data = await accountRequest("/me");
        if (version !== generation) return;
        await S.selectAccount(data.user);
        if (version !== generation) return;
        state = { ...state, ...data, hasUsers: true, ready: true, error: "" };
      } else {
        const data = await accountRequest("/status");
        if (version !== generation) return;
        state = { ...state, ...data, ready: true, error: "" };
      }
    } catch (e) {
      if (version !== generation) return;
      state = {
        ...state,
        ready: true,
        error: e.status === 401 ? "" : e.message,
      };
    }
    emit();
  })().finally(() => (loading = null));
  return loading;
}
export async function loginAccount(nome, pin) {
  const version = ++generation;
  const data = await accountRequest("/login", "POST", { nome, pin });
  if (version !== generation) throw Error("O acesso mudou. Tente novamente.");
  S.setSessionToken(data.token);
  await S.selectAccount(data.user);
  if (version !== generation) throw Error("O acesso mudou. Entre novamente.");
  state = { ...state, ...data, ready: true, hasUsers: true, error: "" };
  emit();
  return { ok: true };
}
// Primeiro acesso: cria o administrador central direto pelo app (o servidor só aceita enquanto não existe nenhum usuário).
export async function setupAdmin(nome, pin) {
  const version = ++generation;
  const data = await accountRequest("/setup", "POST", { nome, pin });
  if (version !== generation) throw Error("O acesso mudou. Tente novamente.");
  S.setSessionToken(data.token);
  await S.selectAccount(data.user);
  if (version !== generation) throw Error("O acesso mudou. Entre novamente.");
  state = { ...state, ...data, ready: true, hasUsers: true, error: "" };
  emit();
  return { ok: true };
}
export async function logoutAccount() {
  ++generation;
  const revocation = accountRequest("/logout", "POST");
  S.setSessionToken("");
  S.leaveAccount();
  state = { ...state, user: null, users: [], roles: [], error: "" };
  emit();
  try {
    await revocation;
  } catch {}
}
export function core() {
  const legacy = window.Core;
  return {
    ...legacy,
    usuario: () => state.user,
    users: () => state.users,
    cargos: () => state.roles,
    permsDoCargo: (n) => state.roles.find((r) => r.nome === n)?.perms || [],
    aberto: () => !state.hasUsers,
    exigeLogin: () => !state.user,
    can: (p) => Boolean(state.user?.perms.includes(p)),
    regs: S.regs,
    criarUsuario: async (u) => {
      try {
        await accountRequest("/users", "POST", u);
        await refreshAccount();
        return { ok: true };
      } catch (e) {
        return { ok: false, erro: e.message };
      }
    },
    primeiroAdmin: async (nome, pin) => {
      try {
        return await setupAdmin(nome, pin);
      } catch (e) {
        // Outra pessoa criou o administrador antes: passa para a tela de entrada.
        if (e.status === 409) await refreshAccount();
        return { ok: false, erro: e.message };
      }
    },
    login: async (nome, pin) => {
      try {
        return await loginAccount(nome, pin);
      } catch (e) {
        return { ok: false, erro: e.message };
      }
    },
    logout: logoutAccount,
  };
}
export function useAccount() {
  const [, tick] = useState(0);
  useEffect(() => {
    const update = () => tick((n) => n + 1);
    window.addEventListener("os:account", update);
    refreshAccount();
    const expired = () => {
      ++generation;
      S.setSessionToken("");
      S.leaveAccount();
      state = { ...state, user: null, users: [], roles: [], error: "" };
      emit();
    };
    window.addEventListener("os:session-expired", expired);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refreshAccount();
    }, 60000);
    const focus = () => refreshAccount();
    window.addEventListener("online", focus);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("os:account", update);
      window.removeEventListener("os:session-expired", expired);
      window.removeEventListener("online", focus);
      window.removeEventListener("focus", focus);
      clearInterval(timer);
    };
  }, []);
  return {
    ...state,
    required: !state.user,
    can: (p) => Boolean(state.user?.perms.includes(p)),
    update: refreshAccount,
    logout: logoutAccount,
    retry: refreshAccount,
  };
}
