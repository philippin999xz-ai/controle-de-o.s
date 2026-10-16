import { useState, useEffect, useRef } from "react";
import { regs, salvarOS, fotoPut } from "../store.js";
import { lerOS, erroAmigavel, ErroApi } from "../api.js";
import { CAMPOS, LONG, KEYS } from "../campos.js";
import { reduzir, b64 } from "../imagem.js";
import Icon from "./Icon.jsx";

export default function Nova({
  srv,
  edit,
  ligar,
  onSaved,
  user,
  canUseAI = true,
  canSave = true,
}) {
  const [d, setD] = useState(edit || {}),
    [inc, setInc] = useState([]),
    [foto, setFoto] = useState(null);
  const [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const cam = useRef(),
    gal = useRef();
  useEffect(
    () => () => {
      if (foto?.url) URL.revokeObjectURL(foto.url);
    },
    [foto],
  ); // não vaza memória a cada foto
  const escolher = async (f) => {
    if (!f) return;
    try {
      const b = await reduzir(f);
      setFoto({ blob: b, url: URL.createObjectURL(b) });
      setMsg("");
    } catch {
      setMsg("Falha ao abrir a imagem.");
    }
  };
  async function ler() {
    if (!canUseAI || busy || !foto) return;
    setBusy(true);
    try {
      let st = srv;
      if (st.s !== "online") {
        setMsg("⏳ Acordando o servidor…");
        st = await ligar();
        if (!st.ok)
          throw new ErroApi("rede", "O backend no Render não respondeu.");
      }
      if (!st.ai)
        throw new ErroApi(
          "ia_off",
          "IA não configurada no servidor (GEMINI_API_KEY no Render).",
        );
      setMsg("🤖 Lendo a foto da OS...");
      const { campos, incertos } = await lerOS(
        await b64(foto.blob),
        foto.blob.type || "image/jpeg",
      );
      setD(campos);
      setInc(incertos);
      setMsg(
        "✅ Foto lida." +
          (incertos.length
            ? " ⚠️ " + incertos.length + " campo(s) em amarelo para conferir."
            : " Confira antes de salvar."),
      );
    } catch (e) {
      console.error(e);
      setMsg("❌ " + erroAmigavel(e) + " Preencha manualmente se preferir.");
    } finally {
      setBusy(false);
    }
  }
  async function salvar() {
    if (!canSave) return;
    const rec = regs(),
      ex = edit ? rec.find((x) => x.id === edit.id) : null;
    const o = ex
      ? { ...ex }
      : {
          id: "os_" + Date.now(),
          criado: new Date().toISOString(),
          foto: false,
          usuario: user?.nome || "",
          usuario_id: user?.id || "",
        };
    KEYS.forEach((k) => (o[k] = (d[k] || "").trim()));
    if (!o.numero_os && !o.equipamento)
      return setMsg("Informe o número da ordem ou o equipamento.");
    try {
      if (foto) {
        await fotoPut(o.id, foto.blob);
        o.foto = true;
      }
    } catch (e) {
      console.error(e);
      return setMsg(
        "Não consegui guardar a foto neste aparelho (sem espaço?).",
      );
    }
    if (ex) {
      o.editado = new Date().toISOString();
      o.editado_por = user?.nome || "";
    }
    if (!salvarOS(o, !!foto))
      return setMsg("Não consegui salvar (armazenamento cheio?).");
    onSaved(ex ? "✅ OS atualizada." : "✅ OS salva.");
  }
  return (
    <div className="card new-order-card">
      <b>{edit ? "Dados da ordem" : "Cadastrar ordem"}</b>
      <div className="mut">{msg || "Preencha à mão ou tire uma foto."}</div>
      <input
        ref={cam}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          escolher(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={gal}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          escolher(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <div className="entry-layout">
        <section className="photo-panel" aria-label="Foto da ordem">
          <div className="photo-heading">
            <Icon name="camera" />
            <h2>Leitura por foto</h2>
          </div>
          <p className="mut">
            Fotografe a ordem para preencher os campos automaticamente.
          </p>
          <div className="photo-actions">
            <button onClick={() => cam.current.click()}>Tirar foto</button>
            <button className="sec" onClick={() => gal.current.click()}>
              Escolher imagem
            </button>
          </div>
          <div className="mut" style={{ marginTop: 8 }}>
            Dica: foto de cima, folha inteira e reta, boa luz.
          </div>
          {foto ? (
            <img className="prev" src={foto.url} alt="Foto da OS" />
          ) : (
            <div className="photo-placeholder">
              <Icon name="orders" size={42} />
              <span>A foto da ordem aparecerá aqui</span>
              <small>JPG, PNG ou outra imagem do aparelho</small>
            </div>
          )}
          <button disabled={!canUseAI || !foto || busy} onClick={ler}>
            {busy ? "Lendo imagem…" : "Ler e preencher"}
          </button>
        </section>
        <section className="fields-panel" aria-label="Dados da ordem">
          <h2>Informações da ordem</h2>
          <p className="mut">Revise os dados antes de salvar.</p>
          <div className="grid">
            {CAMPOS.map(([k, l]) => {
              const p = {
                id: "os-" + k,
                value: d[k] || "",
                placeholder: l,
                className: inc.includes(k) ? "low" : "",
                onChange: (e) => setD({ ...d, [k]: e.target.value }),
              };
              return (
                <div
                  key={k}
                  style={LONG.includes(k) ? { gridColumn: "1/-1" } : {}}
                >
                  <label htmlFor={"os-" + k}>
                    {l}
                    {inc.includes(k) ? " ⚠️ conferir" : ""}
                  </label>
                  {LONG.includes(k) ? <textarea {...p} /> : <input {...p} />}
                </div>
              );
            })}
          </div>
          <div className="form-footer">
            <span className="mut">
              Informe ao menos o número ou equipamento.
            </span>
            <button disabled={!canSave} onClick={salvar}>
              Salvar ordem
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
