import { useState, useEffect, useRef } from "react";
import {
  regs as lerRegs,
  excluirOS,
  iniciarTema,
  exportarBackup,
  importarBackup,
} from "./store.js";
import { sincronizar, configurado } from "./sync.js";
import { acordar } from "./api.js";
import { CAMPOS } from "./campos.js";
import Cab from "./components/Cab.jsx";
import Aviso from "./components/Aviso.jsx";
import Nova from "./components/Nova.jsx";
import OrdersTable from "./components/OrdersTable.jsx";
import Icon from "./components/Icon.jsx";
import AdminPanel from "./components/AdminPanel.jsx";
import Diagnostico from "./components/Diagnostico.jsx";
import useAutoLoad from "./hooks/useAutoLoad.js";
import { useAccount, core } from "./auth.js";
import {
  AccountDialog,
  AccountScreen,
  UserMenu,
} from "./components/AccountAccess.jsx";

const TABS = [
  ["hist", "orders", "Ordens de serviço"],
  ["nova", "plus", "Nova ordem"],
  ["pesq", "search", "Pesquisa"],
  ["dash", "chart", "Indicadores"],
  ["diag", "globe", "Solução de problemas"],
  ["admin", "shield", "Administração"],
  ["cfg", "settings", "Ajustes"],
];
const PAGINA = 30;
const baixar = (nome, blob) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

export default function App() {
  const account = useAccount();
  const [access, setAccess] = useState(null);
  const permits = {
    hist: "pesquisar",
    nova: "criar_os",
    pesq: "pesquisar",
    dash: "dashboard",
    diag: "perguntar_ia",
    admin: "painel_admin",
  };
  const allowed = (k) =>
    k === "admin"
      ? Boolean(account.user && account.can("painel_admin"))
      : !permits[k] || account.can(permits[k]);
  const [, tick] = useState(0),
    refresh = () => tick((n) => n + 1);
  const [tab, setTab] = useState(() =>
      new URLSearchParams(location.search).get("view") === "admin"
        ? "admin"
        : "hist",
    ),
    [edit, setEdit] = useState(null),
    [aviso, setAviso] = useState(""),
    [q, setQ] = useState(""),
    [lim, setLim] = useState(PAGINA);
  const [tipo, setTipo] = useState(""),
    [equip, setEquip] = useState("");
  const [srv, setSrv] = useState({
    s: "acordando",
    ai: false,
    sync: false,
    auth: false,
  });
  const [nuvem, setNuvem] = useState({ s: "off" });
  useEffect(() => {
    if (account.user && !allowed(tab))
      setTab(TABS.find(([k]) => allowed(k))?.[0] || "cfg");
  }, [tab, account.user?.id, account.user?.perms.join("|")]);
  const arq = useRef(),
    ultimo = useRef(0);
  const ligar = async () => {
    setSrv((p) => ({ ...p, s: "acordando" }));
    return acordar((s, i) =>
      setSrv((p) => ({
        s,
        ai: i?.ai ?? p.ai,
        sync: i?.sync ?? p.sync,
        auth: i?.auth ?? p.auth,
      })),
    );
  };
  const sync = async () => {
    if (core()?.exigeLogin() || !configurado()) {
      setNuvem({ s: "off" });
      return { ok: false, msg: "Entre com seu usuário para sincronizar." };
    }
    setNuvem((p) => ({ ...p, s: "sinc" }));
    const r = await sincronizar();
    ultimo.current = Date.now();
    if (r.ok) {
      setNuvem({ s: "ok", quando: new Date() });
      if (r.mudou) refresh();
    } else if (r.pending) setNuvem({ s: "sinc" });
    else setNuvem({ s: "erro", msg: r.msg || "Falha" });
    return r;
  };
  useEffect(() => {
    ligar();
  }, []);
  useEffect(() => {
    try {
      if (!localStorage.getItem("os_tema"))
        document.documentElement.setAttribute("data-theme", "light");
      else iniciarTema();
    } catch {
      iniciarTema();
    }
  }, []);
  useEffect(() => {
    if (!account.user) return;
    let debounce;
    const run = () => {
      if (document.visibilityState === "visible" && navigator.onLine !== false)
        sync();
    };
    const schedule = () => {
      clearTimeout(debounce);
      debounce = setTimeout(run, 200);
    };
    const visibility = () => {
      if (document.visibilityState === "visible") schedule();
    };
    const storage = (e) => {
      if (
        e.key?.startsWith("os_cloud_" + account.user.id + ":") &&
        /:(os_regs|os_pend|os_pend_foto|os_apagados)$/.test(e.key)
      )
        schedule();
    };
    run();
    const timer = setInterval(run, 15000);
    window.addEventListener("online", schedule);
    window.addEventListener("focus", schedule);
    window.addEventListener("os:records-changed", schedule);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(debounce);
      clearInterval(timer);
      window.removeEventListener("online", schedule);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("os:records-changed", schedule);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [account.user?.id]);

  const vis = lerRegs().filter(
    (r) => account.can("ver_historico") || r.usuario_id === account.user?.id,
  );
  const busca = q.trim().toLowerCase(),
    achados = busca
      ? vis.filter((r) => JSON.stringify(r).toLowerCase().includes(busca))
      : vis;
  const filtrados = vis.filter(
    (r) =>
      (!busca || JSON.stringify(r).toLowerCase().includes(busca)) &&
      (!tipo || r.tipo_manutencao === tipo) &&
      (!equip || r.equipamento === equip),
  );
  useEffect(() => { setLim(PAGINA); }, [q, tipo, equip, tab]);
  const totalVisible = tab === "pesq" ? achados.length : filtrados.length;
  const moreOrders = useAutoLoad((tab === "hist" || tab === "pesq") && totalVisible > lim, () => setLim((n) => n + PAGINA), [tab, lim, totalVisible]);
  const nova = () => {
    if (!account.can("criar_os")) return;
    setEdit(null);
    setAviso("");
    setTab("nova");
  };
  const editar = (r) => {
    if (!account.can("editar_os")) return;
    setEdit(r);
    setTab("nova");
  };
  const del = async (r) => {
    if (!account.can("excluir_os")) return;
    if (!confirm("Excluir esta OS?")) return;
    excluirOS(r.id);
    refresh();
    sync();
  };
  const exportar = async () => {
    if (!account.can("exportar") || !vis.length) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(
      vis.map((r) => {
        const x = {};
        CAMPOS.forEach(([k, l]) => (x[l] = r[k] || ""));
        x["Registrado em"] = r.criado;
        return x;
      }),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OS");
    XLSX.writeFile(wb, "historico_os.xlsx");
  };
  const backup = () =>
    baixar(
      "backup_os_" + new Date().toISOString().slice(0, 10) + ".json",
      new Blob([JSON.stringify({ ...exportarBackup(), os_regs: vis })], {
        type: "application/json",
      }),
    );
  const restaurar = async (f) => {
    if (!account.can("painel_admin")) return;
    if (!f) return;
    try {
      const r = importarBackup(JSON.parse(await f.text()));
      setAviso(
        `✅ Backup restaurado: ${r.novos} nova(s), ${r.atualizados} atualizada(s).`,
      );
      refresh();
      sync();
    } catch (e) {
      setAviso("❌ " + (e.message || "Não consegui ler o arquivo."));
    }
  };
  const conta = (f) =>
    Object.entries(
      vis.reduce((a, r) => {
        const k = f(r) || "—";
        a[k] = (a[k] || 0) + 1;
        return a;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

  const signedIn = (message) => {
    account.update();
    setAccess(null);
    setEdit(null);
    if (tab !== "admin") setTab("hist");
    setAviso(message || "");
  };
  if (!account.ready)
    return (
      <main className="access-screen">
        <div className="access-card">
          <h1>Conectando ao servidor…</h1>
          <p>Consultando seus cadastros centrais.</p>
        </div>
      </main>
    );
  if (account.error && !account.user)
    return (
      <main className="access-screen">
        <div className="access-card">
          <h1>Não foi possível conectar</h1>
          <p role="alert">{account.error}</p>
          <button onClick={account.retry}>Tentar novamente</button>
        </div>
      </main>
    );
  if (account.required)
    return (
      <AccountScreen
        setupRequired={!account.hasUsers}
        onRetry={account.retry}
        onSuccess={signedIn}
      />
    );

  return (
    <>
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("hist");
          }}
        >
          <span className="brand-mark">
            <Icon name="tool" size={24} />
          </span>
          <span>
            Controle O.S.<small>Gestão de manutenção</small>
          </span>
        </a>
        <div className="workspace-label">Seu espaço de trabalho</div>
        <nav aria-label="Navegação principal">
          {TABS.filter(([k]) => allowed(k)).map(([k, i, l]) => (
            <button
              key={k}
              className={(tab === k ? "on " : "") + "nav-" + k}
              aria-current={tab === k ? "page" : undefined}
              onClick={() => {
                setAviso("");
                if (k === "nova") setEdit(null);
                setTab(k);
              }}
            >
              <Icon name={i} />
              <span>{l}</span>
              {k === "hist" && <span className="nav-count">{vis.length}</span>}
            </button>
          ))}
        </nav>
        <UserMenu
          user={account.user}
          canAdmin={Boolean(account.user?.perms.includes("painel_admin"))}
          onAccess={setAccess}
          onLogout={() => {
            account.logout();
            setEdit(null);
            setAccess(null);
            setTab("hist");
            setAviso("");
          }}
          onSettings={() => setTab("cfg")}
          onAdmin={() => setTab("admin")}
        />
      </aside>
      <div className="workspace">
        <Cab nuvem={nuvem} />
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1>
                {tab === "nova"
                  ? edit
                    ? "Editar ordem"
                    : "Nova ordem de serviço"
                  : TABS.find((t) => t[0] === tab)?.[2]}
              </h1>
              <p>
                {
                  {
                    hist: "Organize e acompanhe as ordens da sua operação.",
                    nova: "Registre os detalhes da manutenção, com foto ou preenchimento manual.",
                    pesq: "Encontre o que precisa no histórico da manutenção.",
                    dash: "Uma visão dos registros da sua operação.",
                    cfg: "Gerencie seus dados e preferências.",
                    diag: "Pesquise sintomas, investigue causas e consulte referências técnicas.",
                    admin:
                      "Gerencie a equipe, as permissões e os serviços da operação.",
                  }[tab]
                }
              </p>
            </div>
            {tab !== "nova" &&
              !["cfg", "admin", "diag"].includes(tab) &&
              account.can("criar_os") && (
                <button className="primary-action" onClick={nova}>
                  <Icon name="plus" size={18} /> Nova ordem
                </button>
              )}
          </div>
          <Aviso srv={srv} onRetry={ligar} />
          {tab === "admin" && allowed("admin") && (
            <AdminPanel
              onRegister={() => setAccess("register")}
              onChanged={() => {
                account.update();
                setAviso("");
              }}
              onOpenOrders={() => setTab("hist")}
              syncState={nuvem}
            />
          )}
          {tab === "diag" && allowed("diag") && <Diagnostico key={account.user.id} />}
          {aviso && (
            <div className="banner" role="status">
              {aviso}
              <button
                className="dismiss"
                aria-label="Fechar aviso"
                onClick={() => setAviso("")}
              >
                ×
              </button>
            </div>
          )}
          {tab === "nova" && allowed("nova") && (
            <Nova
              key={edit?.id || "novo"}
              srv={srv}
              user={account.user}
              canUseAI={account.can("usar_ia")}
              canSave={account.can(edit ? "editar_os" : "criar_os")}
              edit={edit}
              ligar={ligar}
              onSaved={(m) => {
                setEdit(null);
                setAviso(m);
                setLim(PAGINA);
                setTab("hist");
                sync();
              }}
            />
          )}
          {tab === "pesq" && allowed("pesq") && (
            <section className="card">
              <div className="section-heading">
                <h2>Pesquisar ordens</h2>
              </div>
              <div className="search-field">
                <Icon name="search" />
                <input
                  aria-label="Pesquisar ordens"
                  placeholder="Número, equipamento, serviço ou executante"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {achados.length ? (
                <OrdersTable
                  items={achados.slice(0, lim)}
                  onEdit={account.can("editar_os") ? editar : undefined}
                  onDel={account.can("excluir_os") ? del : undefined}
                  onCreate={account.can("criar_os") ? nova : undefined}
                />
              ) : (
                <div className="empty-state">
                  <Icon name="search" size={30} />
                  <h3>O histórico ao seu alcance</h3>
                  <p>Nenhuma ordem corresponde à pesquisa.</p>
                </div>
              )}
              <div ref={moreOrders} className="mut" role="status">{achados.length > lim ? "Carregando mais ordens…" : `${achados.length} ordens encontradas`}</div>
            </section>
          )}
          {tab === "hist" && allowed("hist") && (
            <>
              <div className="overview-strip">
                <div>
                  <span className="metric-icon">
                    <Icon name="orders" />
                  </span>
                  <div>
                    <span>Ordens registradas</span>
                    <strong>{vis.length}</strong>
                  </div>
                </div>
                <div>
                  <span className="metric-icon">
                    <Icon name="box" />
                  </span>
                  <div>
                    <span>Equipamentos</span>
                    <strong>
                      {
                        new Set(vis.map((r) => r.equipamento).filter(Boolean))
                          .size
                      }
                    </strong>
                  </div>
                </div>
                <div>
                  <span className="metric-icon">
                    <Icon name="camera" />
                  </span>
                  <div>
                    <span>Ordens com foto</span>
                    <strong>{vis.filter((r) => r.foto).length}</strong>
                  </div>
                </div>
              </div>
              <section className="card history-card">
                <div className="section-heading">
                  <h2>
                    Todas as ordens{" "}
                    <span className="count-pill">{vis.length}</span>
                  </h2>
                  <button
                    className="sec export-button"
                    disabled={!vis.length || !account.can("exportar")}
                    onClick={exportar}
                  >
                    <Icon name="arrow" size={17} /> Exportar Excel
                  </button>
                </div>
                <div className="filter-bar">
                  <label className="search-filter">
                    Buscar ordem
                    <div className="search-field">
                      <Icon name="search" size={18} />
                      <input
                        placeholder="Número, equipamento ou serviço..."
                        value={q}
                        onChange={(e) => {
                          setQ(e.target.value);
                          setLim(PAGINA);
                        }}
                      />
                    </div>
                  </label>
                  <label>
                    Equipamento
                    <select
                      aria-label="Filtrar por equipamento"
                      value={equip}
                      onChange={(e) => {
                        setEquip(e.target.value);
                        setLim(PAGINA);
                      }}
                    >
                      <option value="">Todos os equipamentos</option>
                      {[
                        ...new Set(
                          vis.map((r) => r.equipamento).filter(Boolean),
                        ),
                      ]
                        .sort()
                        .map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Tipo de manutenção
                    <select
                      aria-label="Filtrar por tipo de manutenção"
                      value={tipo}
                      onChange={(e) => {
                        setTipo(e.target.value);
                        setLim(PAGINA);
                      }}
                    >
                      <option value="">Todos os tipos</option>
                      {[
                        ...new Set(
                          vis.map((r) => r.tipo_manutencao).filter(Boolean),
                        ),
                      ]
                        .sort()
                        .map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                    </select>
                  </label>
                  {(q || tipo || equip) && (
                    <button
                      className="clear-filter"
                      onClick={() => {
                        setQ("");
                        setTipo("");
                        setEquip("");
                        setLim(PAGINA);
                      }}
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>
                <OrdersTable
                  items={filtrados.slice(0, lim)}
                  onEdit={account.can("editar_os") ? editar : undefined}
                  onDel={account.can("excluir_os") ? del : undefined}
                  onCreate={account.can("criar_os") ? nova : undefined}
                />
                <div className="table-footer">
                  <span>
                    {filtrados.length
                      ? `Exibindo ${Math.min(lim, filtrados.length)} de ${filtrados.length} ordens`
                      : "0 ordens encontradas"}
                  </span>
                  <span ref={moreOrders} role="status">{filtrados.length > lim ? "Carregando mais ordens…" : ""}</span>
                  <span>Dados do seu histórico</span>
                </div>
              </section>
            </>
          )}
          {tab === "dash" && allowed("dash") && (
            <div className="card">
              <b>📈 Painel</b>
              <div className="kpis" style={{ marginTop: 8 }}>
                <div className="kpi">
                  <b>{vis.length}</b>OS
                </div>
                <div className="kpi">
                  <b>
                    {
                      new Set(vis.map((r) => r.equipamento).filter(Boolean))
                        .size
                    }
                  </b>
                  Equipamentos
                </div>
              </div>
              <label>Por tipo</label>
              {conta((r) => r.tipo_manutencao).map(([k, n]) => (
                <div key={k} className="row">
                  {k}: <b>{n}</b>
                </div>
              ))}
              <label>Por executante</label>
              {conta((r) => r.executante).map(([k, n]) => (
                <div key={k} className="row">
                  {k}: <b>{n}</b>
                </div>
              ))}
              <label>Por equipamento</label>
              {conta((r) => r.equipamento).map(([k, n]) => (
                <div key={k} className="row">
                  {k}: <b>{n}</b>
                </div>
              ))}
            </div>
          )}
          {tab === "cfg" && (
            <div className="card">
              <b>⚙️ Ajustes</b>
              <div className="mut" style={{ marginTop: 8 }}>
                Leitura por foto:{" "}
                {srv.s === "online"
                  ? srv.ai
                    ? "🟢 disponível"
                    : "Indisponível no momento"
                  : "⏳ conectando"}
              </div>
              <label>Backup em arquivo</label>
              <div className="mut">
                Cópia de segurança dos registros (sem fotos). Útil mesmo com a
                nuvem ligada.
              </div>
              <button disabled={!account.can("exportar")} onClick={backup}>
                ⬇️ Baixar backup ({vis.length} OS)
              </button>
              <input
                ref={arq}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  restaurar(e.target.files[0]);
                  e.target.value = "";
                }}
              />
              <button
                className="sec"
                disabled={!account.can("painel_admin")}
                onClick={() => arq.current.click()}
              >
                ⬆️ Restaurar backup
              </button>
              <section className="other-tools">
                <h2>Outros</h2>
                <p className="mut">
                  Acesse a administração integrada ao aplicativo.
                </p>
                {account.user?.perms.includes("painel_admin") ||
                core().aberto() ? (
                  <button
                    className="admin-access-card"
                    onClick={() => setTab("admin")}
                  >
                    <Icon name="settings" />
                    <span>
                      <strong>Painel de administração</strong>
                      <small>Equipe, permissões, conexões e dados</small>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                ) : (
                  <p className="mut">
                    O painel e o cadastro de usuários ficam disponíveis para
                    administradores.
                  </p>
                )}
                <button
                  className="sec"
                  onClick={() =>
                    setAccess(
                      account.user && account.can("painel_admin")
                        ? "register"
                        : "login",
                    )
                  }
                >
                  {account.user && account.can("painel_admin")
                    ? "Cadastrar usuário"
                    : "Acessar outra conta"}
                </button>
              </section>
            </div>
          )}
        </main>
      </div>
      {access && (
        <AccountDialog
          mode={access}
          onMode={setAccess}
          onClose={() => setAccess(null)}
          onSuccess={signedIn}
        />
      )}
    </>
  );
}
