import { useState, useEffect, useRef } from "react";
import { pesquisarFalha } from "../api.js";
import Icon from "./Icon.jsx";
export default function Diagnostico() {
  const [equipamento, setEquipamento] = useState(""),
    [codigo, setCodigo] = useState(""),
    [sintoma, setSintoma] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const data = await pesquisarFalha({ equipamento, codigo, sintoma });
      if (alive.current) setResult(data);
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="diagnostic-layout">
      <section className="card diagnostic-form">
        <div className="section-heading">
          <h2>Investigue uma falha</h2>
          <span className="neutral-pill">
            <Icon name="globe" size={14} /> Pesquisa web
          </span>
        </div>
        <p className="mut">
          Descreva o que aconteceu. O assistente pesquisa referências técnicas
          na internet para ajudar na investigação.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="diag-equipment">Equipamento, marca e modelo</label>
          <input
            id="diag-equipment"
            value={equipamento}
            onChange={(e) => setEquipamento(e.target.value)}
            placeholder="Ex.: inversor de frequência, marca e modelo"
            maxLength={200}
          />
          <label htmlFor="diag-code">
            Código de falha <span className="mut">(se houver)</span>
          </label>
          <input
            id="diag-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Digite exatamente como aparece no equipamento"
            maxLength={120}
          />
          <label htmlFor="diag-symptom">O que está acontecendo?</label>
          <textarea
            id="diag-symptom"
            value={sintoma}
            onChange={(e) => setSintoma(e.target.value)}
            placeholder="Descreva os sintomas, quando começaram e em quais condições ocorrem."
            minLength={10}
            maxLength={4000}
            required
          />
          <div className="diagnostic-form-footer">
            <small>{sintoma.length}/4.000 caracteres</small>
            <button disabled={busy || sintoma.trim().length < 10}>
              <Icon name="search" size={17} />
              {busy ? "Pesquisando fontes…" : "Pesquisar falha"}
            </button>
          </div>
        </form>
        <div className="technical-note">
          <Icon name="shield" size={20} />
          <p>
            A resposta traz hipóteses para investigação. Confirme no manual e
            siga os procedimentos de segurança antes de intervir.
          </p>
        </div>
      </section>
      <section
        className="card diagnostic-result"
        aria-label="Resultado da investigação"
        aria-busy={busy}
      >
        {busy ? (
          <div className="empty-state" role="status">
            <span className="search-spinner" />
            <h3>Consultando referências técnicas</h3>
            <p>
              Buscando informações sobre os sintomas e organizando as fontes.
              Isso pode levar até um minuto.
            </p>
          </div>
        ) : error ? (
          <div className="diagnostic-error" role="alert">
            <Icon name="search" size={28} />
            <h3>Não foi possível concluir a pesquisa</h3>
            <p>{error}</p>
          </div>
        ) : result ? (
          <>
            <div className="section-heading">
              <h2>Orientação para investigação</h2>
              <span className="neutral-pill">Com fontes da web</span>
            </div>
            <div className="diagnostic-answer">{result.resposta}</div>
            <div className="diagnostic-sources">
              <h3>Fontes consultadas</h3>
              <ol>
                {result.fontes.map((f) => (
                  <li key={f.url}>
                    <a href={f.url} target="_blank" rel="noopener noreferrer">
                      {f.titulo}
                      <Icon name="external" size={13} />
                    </a>
                    <small>{new URL(f.url).hostname}</small>
                  </li>
                ))}
              </ol>
              <p className="mut">
                Pesquisa realizada em{" "}
                {new Date(result.pesquisadoEm).toLocaleString("pt-BR")}.
              </p>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <Icon name="tool" size={30} />
            </span>
            <h3>Entenda a falha antes de agir</h3>
            <p>
              Informe o equipamento e os sintomas para pesquisar causas
              possíveis, verificações seguras e documentação de referência.
            </p>
            <div className="diagnostic-topics">
              <span>Mecânica</span>
              <span>Elétrica</span>
              <span>Automação</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
