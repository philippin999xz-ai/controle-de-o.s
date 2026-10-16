import { useState, useRef, useEffect } from "react";
import { core } from "../auth.js";
import { req } from "../api.js";
import { getToken, setToken } from "../store.js";
import { resetarAuth } from "../sync.js";
import Icon from "./Icon.jsx";

function Editor({
  title,
  children,
  onClose,
  onSubmit,
  busy,
  submitLabel = "Salvar alterações",
}) {
  const dialog = useRef();
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog
      className="account-dialog admin-dialog"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form autoComplete="off" onSubmit={onSubmit}>
        <div className="editor-heading">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar edição"
          >
            ×
          </button>
        </div>
        {children}
        <div className="editor-actions">
          <button type="button" className="sec" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy}>{busy ? "Salvando…" : submitLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
const SECTIONS = [
  ["overview", "chart", "Visão geral"],
  ["users", "users", "Usuários"],
  ["roles", "shield", "Cargos e permissões"],
  ["connections", "settings", "Conexões e dados"],
];
export default function AdminPanel({ onRegister, onChanged, onOpenOrders }) {
  const [section, setSection] = useState("overview"),
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState("");
  const [editUser, setEditUser] = useState(null),
    [editRole, setEditRole] = useState(null),
    [pin, setPin] = useState(""),
    [modalError, setModalError] = useState(""),
    [busy, setBusy] = useState(false);
  const [token, setAccessToken] = useState(""),
    [connected, setConnected] = useState(Boolean(getToken())),
    [health, setHealth] = useState(null),
    [checking, setChecking] = useState(false);
  const upload = useRef();
  const users = core().users(),
    roles = core().cargos(),
    records = core().regs(),
    me = core().usuario();
  const active = users.filter((u) => u.ativo).length;
  const isAdmin = (u) =>
    u.ativo && core().permsDoCargo(u.cargo).includes("painel_admin");
  const shown = users.filter((u) =>
    (u.nome + " " + u.cargo)
      .toLocaleLowerCase("pt-BR")
      .includes(query.trim().toLocaleLowerCase("pt-BR")),
  );
  const changed = (message) => {
    setNotice(message);
    onChanged();
  };
  function validAdmin(list, roleList = roles) {
    return list.some(
      (u) =>
        u.ativo &&
        roleList
          .find((r) => r.nome === u.cargo)
          ?.perms.includes("painel_admin"),
    );
  }
  async function saveUser(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setModalError("");
    try {
      const next = users.map((u) =>
        u.id === editUser.id
          ? {
              ...u,
              nome: editUser.nome.trim(),
              cargo: editUser.cargo,
              ativo: editUser.ativo,
            }
          : u,
      );
      if (!editUser.nome.trim()) throw Error("Informe o nome do usuário.");
      if (
        next.some(
          (u) =>
            u.id !== editUser.id &&
            u.nome.toLowerCase() === editUser.nome.trim().toLowerCase(),
        )
      )
        throw Error("Já existe um usuário com esse nome.");
      if (!validAdmin(next))
        throw Error("Mantenha pelo menos um administrador ativo.");
      if (editUser.id === me.id && !editUser.ativo)
        throw Error("Você não pode desativar a própria conta.");
      if (pin && !core().pinValido(pin))
        throw Error("O novo PIN deve ter de 4 a 8 números.");
      if (!core().saveUsers(next))
        throw Error("Não foi possível salvar os usuários.");
      if (pin) {
        const r = await core().definirPin(editUser.id, pin);
        if (!r.ok) throw Error(r.erro);
      }
      setEditUser(null);
      setPin("");
      changed("Usuário atualizado.");
    } catch (e) {
      setModalError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function deleteUser() {
    const next = users.filter((u) => u.id !== editUser.id);
    if (editUser.id === me.id || !validAdmin(next)) {
      setModalError(
        "Você não pode excluir a própria conta ou o último administrador.",
      );
      return;
    }
    // Explicit confirmation stays inside the editor, without a browser prompt.
    setEditUser({ ...editUser, confirmDelete: true });
  }
  function confirmDeleteUser() {
    if (!core().saveUsers(users.filter((u) => u.id !== editUser.id))) {
      setModalError("Não foi possível excluir o usuário.");
      return;
    }
    setEditUser(null);
    changed("Usuário excluído. As ordens de serviço foram preservadas.");
  }
  function saveRole(e) {
    e.preventDefault();
    setModalError("");
    try {
      const name = editRole.nome.trim();
      if (!name) throw Error("Informe o nome do cargo.");
      if (
        roles.some(
          (r) =>
            r.nome !== editRole.original &&
            r.nome.toLowerCase() === name.toLowerCase(),
        )
      )
        throw Error("Já existe um cargo com esse nome.");
      const value = {
        nome: name,
        nivel: Number(editRole.nivel),
        perms: editRole.perms,
        fixo: false,
      };
      if (!Number.isInteger(value.nivel) || value.nivel < 1 || value.nivel > 98)
        throw Error("Use um nível de 1 a 98.");
      const next = editRole.original
        ? roles.map((r) => (r.nome === editRole.original ? value : r))
        : [...roles, value];
      const nextUsers = users.map((u) =>
        u.cargo === editRole.original ? { ...u, cargo: name } : u,
      );
      if (!validAdmin(nextUsers, next))
        throw Error("Mantenha pelo menos um administrador ativo.");
      if (!core().saveCargos(next))
        throw Error("Não foi possível salvar o cargo.");
      if (!core().saveUsers(nextUsers)) {
        core().saveCargos(roles);
        throw Error("Não foi possível atualizar os usuários do cargo.");
      }
      setEditRole(null);
      changed("Cargo salvo.");
    } catch (e) {
      setModalError(e.message);
    }
  }
  async function checkConnection() {
    setChecking(true);
    try {
      const r = await req("/api/health", {}, 12000);
      if (!r.ok) throw Error();
      setHealth(await r.json());
    } catch {
      setHealth({ ok: false });
    } finally {
      setChecking(false);
    }
  }
  function saveAccess(e) {
    e.preventDefault();
    if (token.trim().length < 16) {
      setNotice("A chave de acesso precisa ter pelo menos 16 caracteres.");
      return;
    }
    setToken(token);
    resetarAuth();
    setAccessToken("");
    setConnected(true);
    changed("Acesso do aplicativo atualizado neste aparelho.");
  }
  function backup() {
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(core().exportarBackup())], {
          type: "application/json",
        }),
      );
    a.href = url;
    a.download =
      "backup_administracao_" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function restore(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data?.os_regs))
        throw Error("Arquivo de backup inválido.");
      const result = core().importarBackup(data);
      changed(
        `Backup importado: ${result.nr} ordem(ns), ${result.nu} usuário(s) e ${result.nc} cargo(s) novo(s). Os dados existentes foram preservados.`,
      );
    } catch (e) {
      setNotice(e.message || "Não foi possível importar o backup.");
    }
  }
  return (
    <div className="administration">
      <div className="admin-section-nav" aria-label="Seções da administração">
        {SECTIONS.map(([id, icon, label]) => (
          <button
            key={id}
            className={section === id ? "selected" : ""}
            aria-pressed={section === id}
            onClick={() => {
              setSection(id);
              setNotice("");
            }}
          >
            <Icon name={icon} size={17} />
            {label}
          </button>
        ))}
      </div>
      {notice && (
        <div className="banner" role="status">
          {notice}
        </div>
      )}
      {section === "overview" && (
        <>
          <div className="admin-metrics">
            <div>
              <Icon name="users" />
              <span>
                Usuários ativos
                <strong>
                  {active}
                  <small> de {users.length} cadastrados</small>
                </strong>
              </span>
            </div>
            <div>
              <Icon name="shield" />
              <span>
                Cargos configurados<strong>{roles.length}</strong>
              </span>
            </div>
            <div>
              <Icon name="orders" />
              <span>
                Ordens registradas<strong>{records.length}</strong>
              </span>
            </div>
          </div>
          <div className="admin-overview-grid">
            <section className="card">
              <div className="section-heading">
                <h2>Acessos da equipe</h2>
                <button
                  className="text-button"
                  onClick={() => setSection("users")}
                >
                  Gerenciar usuários
                  <Icon name="chevron" size={14} />
                </button>
              </div>
              <p className="mut">
                Organize os acessos por responsabilidade, mantendo as permissões
                de cada cargo.
              </p>
              <div className="admin-role-distribution">
                {roles.map((r) => {
                  const n = users.filter((u) => u.cargo === r.nome).length;
                  return (
                    <div key={r.nome}>
                      <span>{r.nome}</span>
                      <div>
                        <i
                          style={{
                            width: users.length
                              ? `${(n / users.length) * 100}%`
                              : "0%",
                          }}
                        />
                      </div>
                      <strong>{n}</strong>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="card admin-quick">
              <h2>Administração da operação</h2>
              <p className="mut">
                Os controles do sistema, reunidos em um só lugar.
              </p>
              <button className="sec" onClick={onRegister}>
                <Icon name="plus" />
                Cadastrar usuário
              </button>
              <button className="sec" onClick={() => setSection("roles")}>
                <Icon name="shield" />
                Revisar permissões
              </button>
              <button className="sec" onClick={onOpenOrders}>
                <Icon name="orders" />
                Consultar ordens
              </button>
              <div className="admin-account-note">
                <Icon name="user" size={16} />
                <span>
                  {me.nome}
                  <small>{me.cargo}</small>
                </span>
              </div>
            </section>
          </div>
        </>
      )}
      {section === "users" && (
        <section className="card admin-table-card">
          <div className="section-heading">
            <div>
              <h2>
                Usuários da equipe{" "}
                <span className="count-pill">{users.length}</span>
              </h2>
              <p className="mut">
                Cadastre, revise acessos e redefina o PIN quando necessário.
              </p>
            </div>
            <button onClick={onRegister}>
              <Icon name="plus" size={17} />
              Novo usuário
            </button>
          </div>
          <div className="admin-table-tools">
            <div className="search-field">
              <Icon name="search" size={18} />
              <input
                aria-label="Buscar usuários"
                placeholder="Buscar por nome ou cargo"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <span className="mut">{shown.length} usuário(s)</span>
          </div>
          <div className="table-scroll">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Cargo</th>
                  <th>Status</th>
                  <th>Criado em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="user-table-name">
                        <span className="user-initial">
                          {u.nome.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>
                          {u.nome}
                          {u.id === me.id && <small>Você</small>}
                        </strong>
                      </span>
                    </td>
                    <td>{u.cargo}</td>
                    <td>
                      <span
                        className={
                          "status-tag " + (u.ativo ? "active" : "inactive")
                        }
                      >
                        <i />
                        {u.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="date-cell">
                      {u.criado
                        ? new Date(u.criado).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td>
                      <button
                        className="table-edit"
                        aria-label={"Gerenciar " + u.nome}
                        onClick={() => {
                          setEditUser({ ...u });
                          setPin("");
                          setModalError("");
                        }}
                      >
                        Gerenciar
                        <Icon name="chevron" size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && (
              <div className="empty-state">
                <h3>Nenhum usuário encontrado</h3>
                <p>Ajuste a busca para localizar alguém da equipe.</p>
              </div>
            )}
          </div>
        </section>
      )}
      {section === "roles" && (
        <>
          <div className="admin-content-heading">
            <div>
              <h2>Permissões por responsabilidade</h2>
              <p className="mut">
                Defina o que cada grupo pode acessar no aplicativo.
              </p>
            </div>
            <button
              onClick={() => {
                setEditRole({ nome: "", nivel: "", perms: [] });
                setModalError("");
              }}
            >
              <Icon name="plus" size={17} />
              Novo cargo
            </button>
          </div>
          <div className="role-cards">
            {roles.map((r) => (
              <section className="card role-card" key={r.nome}>
                <div className="role-card-heading">
                  <span className="role-icon">
                    <Icon name="shield" />
                  </span>
                  <span className="neutral-pill">Nível {r.nivel}</span>
                </div>
                <h3>{r.nome}</h3>
                <p className="mut">
                  {users.filter((u) => u.cargo === r.nome).length} usuário(s) ·{" "}
                  {r.perms.length} permissões
                </p>
                <ul>
                  {r.perms.slice(0, 3).map((p) => (
                    <li key={p}>
                      <Icon name="check" size={14} />
                      {core().PERMS.find(([k]) => k === p)?.[1]}
                    </li>
                  ))}
                </ul>
                <button
                  className="sec"
                  onClick={() => {
                    setEditRole({ ...r, original: r.nome });
                    setModalError("");
                  }}
                >
                  {r.fixo ? "Ver permissões" : "Editar cargo"}
                </button>
              </section>
            ))}
          </div>
        </>
      )}
      {section === "connections" && (
        <div className="connections-grid">
          <section className="card">
            <div className="section-heading">
              <h2>Serviços da operação</h2>
              <button
                className="text-button"
                onClick={checkConnection}
                disabled={checking}
              >
                {checking ? "Verificando…" : "Verificar conexão"}
              </button>
            </div>
            <div className="service-status">
              <span>API do aplicativo</span>
              <span className="neutral-pill">
                {health
                  ? health.ok
                    ? "Online"
                    : "Sem resposta"
                  : "Não verificada"}
              </span>
            </div>
            <div className="service-status">
              <span>Assistente e leitura por IA</span>
              <span className="neutral-pill">
                {health?.ok
                  ? health.ai
                    ? "Configurada"
                    : "Não configurada"
                  : "Não verificada"}
              </span>
            </div>
            <div className="service-status">
              <span>Sincronização / Turso</span>
              <span className="neutral-pill">
                {health?.ok
                  ? health.sync
                    ? "Disponível"
                    : "Não configurada"
                  : "Não verificada"}
              </span>
            </div>
            <p className="mut">
              As chaves do provedor de IA e as credenciais do banco são
              configuradas somente no servidor.
            </p>
          </section>
          <section className="card">
            <h2>Acesso à sincronização</h2>
            <p className="mut">
              {connected
                ? "Este aparelho tem uma chave de acesso configurada."
                : "Este aparelho ainda não tem uma chave de acesso configurada."}
            </p>
            <form onSubmit={saveAccess} autoComplete="off">
              <label htmlFor="admin-cloud">
                Nova chave de acesso do aplicativo
              </label>
              <input
                id="admin-cloud"
                type="password"
                autoComplete="new-password"
                value={token}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Digite somente se quiser configurar ou trocar"
                minLength={16}
              />
              <div className="editor-actions">
                <button disabled={!token.trim()}>Salvar acesso</button>
                {connected && (
                  <button
                    type="button"
                    className="sec"
                    onClick={() => {
                      setToken("");
                      resetarAuth();
                      setConnected(false);
                      setAccessToken("");
                      changed(
                        "Acesso removido deste aparelho. Os registros foram mantidos.",
                      );
                    }}
                  >
                    Desconectar aparelho
                  </button>
                )}
              </div>
            </form>
          </section>
          <section className="card admin-backup">
            <span className="role-icon">
              <Icon name="arrow" />
            </span>
            <h2>Cópia de segurança</h2>
            <p className="mut">
              Exporte ordens, usuários e cargos. Os PINs não são incluídos em
              texto: o cadastro utiliza hashes. Fotos não fazem parte deste
              arquivo.
            </p>
            <div className="editor-actions">
              <button onClick={backup}>Exportar backup</button>
              <button className="sec" onClick={() => upload.current.click()}>
                Importar backup
              </button>
            </div>
            <input
              ref={upload}
              type="file"
              hidden
              accept=".json,application/json"
              onChange={(e) => {
                restore(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </section>
        </div>
      )}
      {editUser && (
        <Editor
          title={
            editUser.confirmDelete ? "Excluir usuário" : "Gerenciar usuário"
          }
          submitLabel={
            editUser.confirmDelete ? "Excluir usuário" : "Salvar alterações"
          }
          onClose={() => setEditUser(null)}
          onSubmit={
            editUser.confirmDelete
              ? (e) => {
                  e.preventDefault();
                  confirmDeleteUser();
                }
              : saveUser
          }
          busy={busy}
        >
          {editUser.confirmDelete ? (
            <p>
              Excluir {editUser.nome}? As ordens registradas por essa pessoa
              serão mantidas.
            </p>
          ) : (
            <>
              <label htmlFor="manage-name">Nome</label>
              <input
                id="manage-name"
                value={editUser.nome}
                onChange={(e) =>
                  setEditUser({ ...editUser, nome: e.target.value })
                }
                maxLength={60}
                required
              />
              <label htmlFor="manage-role">Cargo</label>
              <select
                id="manage-role"
                value={editUser.cargo}
                onChange={(e) =>
                  setEditUser({ ...editUser, cargo: e.target.value })
                }
              >
                {roles.map((r) => (
                  <option key={r.nome}>{r.nome}</option>
                ))}
              </select>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editUser.ativo}
                  disabled={editUser.id === me.id}
                  onChange={(e) =>
                    setEditUser({ ...editUser, ativo: e.target.checked })
                  }
                />
                Usuário ativo
              </label>
              <label htmlFor="manage-pin">
                Novo PIN <span className="mut">(opcional)</span>
              </label>
              <input
                id="manage-pin"
                type="password"
                autoComplete="new-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]{4,8}"
                maxLength={8}
                placeholder="Deixe vazio para manter o PIN atual"
              />
              {editUser.id !== me.id && (
                <button
                  type="button"
                  className="danger-text"
                  onClick={deleteUser}
                >
                  Excluir usuário
                </button>
              )}
            </>
          )}
          {modalError && (
            <p className="err" role="alert">
              {modalError}
            </p>
          )}
        </Editor>
      )}
      {editRole && (
        <Editor
          title={
            editRole.fixo
              ? "Permissões do administrador"
              : editRole.original
                ? "Editar cargo"
                : "Novo cargo"
          }
          onClose={() => setEditRole(null)}
          onSubmit={
            editRole.fixo
              ? (e) => {
                  e.preventDefault();
                  setEditRole(null);
                }
              : saveRole
          }
        >
          <label htmlFor="role-name">Nome do cargo</label>
          <input
            id="role-name"
            value={editRole.nome}
            disabled={editRole.fixo}
            onChange={(e) => setEditRole({ ...editRole, nome: e.target.value })}
            maxLength={60}
            required
          />
          <label htmlFor="role-level">Nível de responsabilidade</label>
          <input
            id="role-level"
            type="number"
            min={1}
            max={98}
            value={editRole.nivel}
            disabled={editRole.fixo}
            required
            onChange={(e) =>
              setEditRole({ ...editRole, nivel: e.target.value })
            }
          />
          <fieldset className="permissions-list">
            <legend>Recursos disponíveis</legend>
            {core().PERMS.map(([key, label]) => (
              <label className="checkbox-label" key={key}>
                <input
                  type="checkbox"
                  checked={editRole.perms.includes(key)}
                  disabled={editRole.fixo}
                  onChange={(e) =>
                    setEditRole({
                      ...editRole,
                      perms: e.target.checked
                        ? [...editRole.perms, key]
                        : editRole.perms.filter((p) => p !== key),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          {modalError && (
            <p className="err" role="alert">
              {modalError}
            </p>
          )}
          {!editRole.fixo && editRole.original && (
            <button
              className="danger-text"
              type="button"
              disabled={users.some((u) => u.cargo === editRole.original)}
              onClick={() => {
                core().saveCargos(
                  roles.filter((r) => r.nome !== editRole.original),
                );
                setEditRole(null);
                changed("Cargo removido.");
              }}
            >
              Excluir cargo sem usuários
            </button>
          )}
        </Editor>
      )}
    </div>
  );
}
