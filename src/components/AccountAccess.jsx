import { useState, useEffect, useRef } from "react";
import { core } from "../auth.js";
import Icon from "./Icon.jsx";

export function AccessForm({ mode = "login", onSuccess, onMode }) {
  const [name, setName] = useState(""),
    [pin, setPin] = useState(""),
    [repeat, setRepeat] = useState(""),
    [role, setRole] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const initial = core().aberto();
  const register = mode === "register";
  const mayRegister = Boolean(core().usuario()?.perms.includes("painel_admin"));
  const users = core()
    .users()
    .filter((u) => u.ativo);
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (register) {
        if (!initial && !mayRegister)
          throw Error("O cadastro de usuários é feito pela administração.");
        if (pin !== repeat) throw Error("Os PINs não conferem.");
        const result = initial
          ? await core().primeiroAdmin(name.trim(), pin)
          : await core().criarUsuario({ nome: name, cargo: role, pin });
        if (!result.ok) throw Error(result.erro);
        setPin("");
        setRepeat("");
        onSuccess(initial ? "" : "Usuário cadastrado.");
      } else {
        const result = await core().login(name.trim(), pin);
        setPin("");
        if (!result.ok) throw Error(result.erro);
        onSuccess("");
      }
    } catch (e) {
      setError(e.message || "Não foi possível concluir o acesso.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="access-form">
      <img className="app-logo" src="./logo.png" alt="Açoforja" />
      <h1>
        {register
          ? initial
            ? "Configure seu primeiro acesso"
            : "Cadastrar usuário"
          : "Acesse seu espaço"}
      </h1>
      <p className="mut">
        {register
          ? initial
            ? "Crie a conta de administração para organizar os acessos da equipe. Depois de criada, esta etapa é fechada: ninguém mais consegue se cadastrar como administrador."
            : "O novo usuário terá as permissões do cargo selecionado."
          : "Entre com seu usuário e PIN para continuar a manutenção."}
      </p>
      <form autoComplete="off" onSubmit={submit}>
        {register ? (
          <>
            <label htmlFor="access-name">Nome</label>
            <input
              id="access-name"
              name="account-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Digite o nome"
              maxLength={60}
              required
            />
            {!initial && (
              <>
                <label htmlFor="access-role">Cargo</label>
                <select
                  id="access-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Selecione um cargo
                  </option>
                  {core()
                    .cargos()
                    .map((c) => (
                      <option key={c.nome}>{c.nome}</option>
                    ))}
                </select>
              </>
            )}
          </>
        ) : (
          <>
            <label htmlFor="access-user">Usuário</label>
            <input
              id="access-user"
              name="access-identity"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Digite seu nome de usuário"
              maxLength={60}
              required
            />
          </>
        )}
        <label htmlFor="access-pin">{register ? "Crie um PIN" : "PIN"}</label>
        <input
          id="access-pin"
          name="account-pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="De 4 a 8 números"
          pattern="[0-9]{4,8}"
          minLength={4}
          maxLength={8}
          required
        />
        {register && (
          <>
            <label htmlFor="access-repeat">Confirme o PIN</label>
            <input
              id="access-repeat"
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              placeholder="Digite o PIN novamente"
              pattern="[0-9]{4,8}"
              maxLength={8}
              required
            />
          </>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button
          className="access-submit"
          disabled={busy || (register && !initial && !mayRegister)}
        >
          {busy ? "Aguarde…" : register ? "Criar conta" : "Entrar"}
        </button>
      </form>
      {initial && (
        <button
          className="access-switch"
          onClick={() => onMode(register ? "login" : "register")}
        >
          {register
            ? "Voltar ao acesso"
            : "Primeiro acesso? Criar administrador"}
        </button>
      )}
      {!register && !initial && (
        <p className="access-help">
          Precisa de uma conta? Solicite o cadastro ao administrador.
        </p>
      )}
      <p className="access-local">
        Seu usuário e suas permissões são os mesmos em todos os aparelhos.
      </p>
    </div>
  );
}
export function AccountDialog({ mode, onClose, onSuccess, onMode }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="account-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <button
        className="dialog-close"
        onClick={onClose}
        aria-label="Fechar acesso"
      >
        ×
      </button>
      <AccessForm
        key={mode}
        mode={mode}
        onSuccess={onSuccess}
        onMode={onMode}
      />
    </dialog>
  );
}
export function AccountScreen({
  onSuccess,
  initialMode = "login",
  setupRequired = false,
  onRetry,
}) {
  const [mode, setMode] = useState(setupRequired ? "register" : initialMode);
  // Se o administrador for criado em outro aparelho enquanto esta tela está aberta, volta para a entrada.
  useEffect(() => {
    if (!setupRequired) setMode("login");
  }, [setupRequired]);
  return (
    <main className="access-screen">
      <div className="access-intro">
        <span>Controle O.S.</span>
        <h2>
          Foco em manutenção e operação contínua, com eficiência e agilidade.
        </h2>
        <p>
          Ordens, equipamentos, histórico de manutenção e solução de problemas
          em um único espaço.
        </p>
      </div>
      <div className="access-card">
        <AccessForm
          key={mode}
          mode={mode}
          onSuccess={onSuccess}
          onMode={setMode}
        />
      </div>
    </main>
  );
}
export function UserMenu({
  user,
  onAccess,
  onLogout,
  onSettings,
  onAdmin,
  canAdmin,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(),
    trigger = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!ref.current.contains(e.target)) setOpen(false);
    };
    const key = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const action = (f) => {
    setOpen(false);
    f();
  };
  return (
    <div className="user-menu" ref={ref}>
      <button
        ref={trigger}
        className="user-trigger"
        aria-label="Menu do usuário"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen(!open)}
      >
        <span className="workspace-avatar">
          {user?.nome?.trim().slice(0, 1).toUpperCase() || (
            <Icon name="user" size={18} />
          )}
        </span>
        <span className="user-summary">
          {user?.nome || "Minha conta"}
          <small>{user?.cargo || "Acessar ou cadastrar"}</small>
        </span>
        <Icon name="chevron" size={15} />
      </button>
      {open && (
        <div className="user-popover" id="account-menu">
          <div className="account-summary">
            <strong>{user?.nome || "Bem-vindo"}</strong>
            <span>{user?.cargo || "Gerencie seu acesso ao aplicativo"}</span>
          </div>
          {!user && (
            <button onClick={() => action(() => onAccess("login"))}>
              Entrar
            </button>
          )}
          {core().aberto() && (
            <button onClick={() => action(() => onAccess("register"))}>
              Criar administrador
            </button>
          )}
          {user && canAdmin && (
            <button onClick={() => action(() => onAccess("register"))}>
              Cadastrar usuário
            </button>
          )}
          <button onClick={() => action(onSettings)}>Ajustes e outros</button>
          {(canAdmin || core().aberto()) && (
            <button onClick={() => action(onAdmin)}>
              Painel de administração <Icon name="chevron" size={14} />
            </button>
          )}
          {user && (
            <button className="logout-action" onClick={() => action(onLogout)}>
              Sair da conta
            </button>
          )}
        </div>
      )}
    </div>
  );
}
