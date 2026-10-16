import { alternarTema } from "../store.js";
import Icon from "./Icon.jsx";
export default function Cab({ nuvem }) {
  const status = {
    sinc: "Sincronizando",
    ok: "Sincronizado",
    erro: "Falha na sincronização",
    off: "Dados neste aparelho",
  };
  return (
    <header className="topbar">
      <img className="app-logo header-logo" src="./logo.png" alt="Açoforja" />
      <div className="breadcrumb">
        Área de trabalho <span>/</span> <strong>Manutenção</strong>
      </div>
      <div className="header-actions">
        <span
          className={"connection " + (nuvem?.s || "off")}
          title={nuvem?.msg || status[nuvem?.s] || status.off}
        >
          <i />
          {status[nuvem?.s] || status.off}
        </span>
        {nuvem?.s === "erro" && (
          <span className="sync-error-detail" role="status">
            {nuvem.msg}
          </span>
        )}
        <button
          className="tema"
          aria-label="Alternar tema claro/escuro"
          onClick={alternarTema}
        >
          <Icon name="sun" />
        </button>
      </div>
    </header>
  );
}
