import { useState, useEffect, useRef } from "react";
import {
  regs as lerRegs,
  excluirOS,
  iniciarTema,
  exportarBackup,
  importarBackup,
  getToken,
  setToken,
} from "./store.js";
import { sincronizar, configurado, resetarAuth } from "./sync.js";
import { acordar } from "./api.js";
import { CAMPOS } from "./campos.js";
import Cab from "./components/Cab.jsx";
import Aviso from "./components/Aviso.jsx";
import Nova from "./components/Nova.jsx";
import OrdersTable from "./components/OrdersTable.jsx";
import Icon from "./components/Icon.jsx";

const TABS = [
  ["hist", "orders", "Ordens de serviço"],
  ["nova", "plus", "Nova ordem"],
  ["pesq", "search", "Pesquisa"],
  ["dash", "chart", "Indicadores"],
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
  const [, tick] = useState(0),
    refresh = () => tick((n) => n + 1);
  const [tab, setTab] = useState("hist"),
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
  const [nuvem, setNuvem] = useState({ s: "off" }),
    [chave, setChave] = useState("");
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
    if (!configurado()) {
      setNuvem({ s: "off" });
      return;
    }
    setNuvem((p) => ({ ...p, s: "sinc" }));
    const r = await sincronizar();
    ultimo.current = Date.now();
    if (r.ok) {
      setNuvem({ s: "ok", quando: new Date() });
      if (r.mudou) refresh();
    } else setNuvem({ s: "erro", msg: r.msg || "Falha" });
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
    if (srv.s === "online" && srv.sync) sync();
  }, [srv.s, srv.sync]); // ao abrir
  useEffect(() => {
    // ao voltar para o app (celular <-> PC)
    const f = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - ultimo.current > 60000
      )
        sync();
    };
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  const vis = lerRegs();
  const busca = q.trim().toLowerCase(),
    achados = busca
      ? vis.filter((r) => JSON.stringify(r).toLowerCase().includes(busca))
      : [];
  const filtrados = vis.filter(
    (r) =>
      (!busca || JSON.stringify(r).toLowerCase().includes(busca)) &&
      (!tipo || r.tipo_manutencao === tipo) &&
      (!equip || r.equipamento === equip),
  );
  const nova = () => {
    setEdit(null);
    setAviso("");
    setTab("nova");
  };
  const editar = (r) => {
    setEdit(r);
    setTab("nova");
  };
  const del = async (r) => {
    if (!confirm("Excluir esta OS?")) return;
    excluirOS(r.id);
    refresh();
    sync();
  };
  const exportar = async () => {
    if (!vis.length) return;
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
      new Blob([JSON.stringify(exportarBackup())], {
        type: "application/json",
      }),
    );
  const salvarChave = () => {
    setToken(chave);
    setChave("");
    resetarAuth();
    sync();
  };
  const restaurar = async (f) => {
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

  return (
    <>
      <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
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
          {TABS.map(([k, i, l]) => (
            <button
              key={k}
              className={tab === k ? "on" : ""}
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
        <div className="sidebar-footer">
          <span className="workspace-avatar">M</span>
          <div>
            Manutenção<small>Organização pessoal</small>
          </div>
          <Icon name="chevron" size={16} />
        </div>
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
                  }[tab]
                }
              </p>
            </div>
            {tab !== "nova" && tab !== "cfg" && (
              <button className="primary-action" onClick={nova}>
                <Icon name="plus" size={18} /> Nova ordem
              </button>
            )}
          </div>
          <Aviso srv={srv} onRetry={ligar} />
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
          {tab === "nova" && (
            <Nova
              key={edit?.id || "novo"}
              srv={srv}
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
          {tab === "pesq" && (
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
              {busca ? (
                <OrdersTable
                  items={achados}
                  onEdit={editar}
                  onDel={del}
                  onCreate={nova}
                />
              ) : (
                <div className="empty-state">
                  <Icon name="search" size={30} />
                  <h3>O histórico ao seu alcance</h3>
                  <p>Digite um número, equipamento ou serviço para começar.</p>
                </div>
              )}
            </section>
          )}
          {tab === "hist" && (
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
                    disabled={!vis.length}
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
                  onEdit={editar}
                  onDel={del}
                  onCreate={nova}
                />
                <div className="table-footer">
                  <span>
                    {filtrados.length
                      ? `Exibindo ${Math.min(lim, filtrados.length)} de ${filtrados.length} ordens`
                      : "0 ordens encontradas"}
                  </span>
                  {filtrados.length > lim && (
                    <button
                      className="sec"
                      onClick={() => setLim((l) => l + PAGINA)}
                    >
                      Mostrar mais
                    </button>
                  )}
                  <span>Dados do seu histórico</span>
                </div>
              </section>
            </>
          )}
          {tab === "dash" && (
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
                    : "🔴 indisponível (GEMINI_API_KEY no servidor)"
                  : "⏳ conectando"}
              </div>
              <label>☁️ Nuvem — mesmo histórico no celular e no PC</label>
              {srv.s === "online" && !srv.sync && (
                <div className="mut">
                  Nuvem não está ligada no servidor (faltam TURSO_DATABASE_URL,
                  TURSO_AUTH_TOKEN e APP_TOKEN no Render). Veja o LEIAME.
                </div>
              )}
              {(srv.sync || configurado()) && (
                <>
                  <div className="mut">
                    {configurado() ? (
                      <>
                        Chave de acesso neste aparelho: ✅ definida. Estado:{" "}
                        {
                          {
                            off: "—",
                            sinc: "⏳ sincronizando…",
                            ok:
                              "☁️ sincronizado às " +
                              (nuvem.quando?.toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              }) || ""),
                            erro: "⚠️ " + (nuvem.msg || "falha"),
                          }[nuvem.s]
                        }
                      </>
                    ) : (
                      "Informe a chave de acesso (a mesma APP_TOKEN do servidor) para ligar a nuvem neste aparelho."
                    )}
                  </div>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      configurado()
                        ? "Trocar chave de acesso…"
                        : "Chave de acesso (APP_TOKEN)"
                    }
                    value={chave}
                    onChange={(e) => setChave(e.target.value)}
                  />
                  <button
                    disabled={chave.trim().length < 16}
                    onClick={salvarChave}
                  >
                    Salvar chave e sincronizar
                  </button>
                  {configurado() && (
                    <button
                      className="sec"
                      onClick={() => {
                        resetarAuth();
                        sync();
                      }}
                    >
                      🔄 Sincronizar agora
                    </button>
                  )}
                  {configurado() && (
                    <button
                      className="sec"
                      onClick={() => {
                        if (
                          confirm(
                            "Remover a chave deste aparelho? Os dados daqui continuam, mas param de sincronizar.",
                          )
                        ) {
                          setToken("");
                          setNuvem({ s: "off" });
                          refresh();
                        }
                      }}
                    >
                      Desligar nuvem neste aparelho
                    </button>
                  )}
                </>
              )}
              <label>Backup em arquivo</label>
              <div className="mut">
                Cópia de segurança dos registros (sem fotos). Útil mesmo com a
                nuvem ligada.
              </div>
              <button onClick={backup}>
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
              <button className="sec" onClick={() => arq.current.click()}>
                ⬆️ Restaurar backup
              </button>
              <label>Outros</label>
              <a className="lk" href="admin.html">
                Painel antigo (manuais e peças)
              </a>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
