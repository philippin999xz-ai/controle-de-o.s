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
      <div className="breadcrumb">
        Área de trabalho <span>/</span> <strong>Manutenção</strong>
      </div>
      <div className="header-actions">
        <span className={"connection " + (nuvem?.s || "off")}>
          <i />
          {status[nuvem?.s] || status.off}
        </span>
        <button
          className="tema"
          aria-label="Alternar tema claro/escuro"
          onClick={alternarTema}
        >
          <Icon name="sun" />
        </button>
        <span className="avatar" title="Área pessoal">
          OS
        </span>
      </div>
    </header>
  );
}
