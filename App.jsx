import {useState,useEffect,useRef} from "react";
import * as XLSX from "xlsx";
import Core from "./core.js";
import {acordar,gem,erroAmigavel,ErroApi} from "./api.js";
import {CAMPOS,LONG,KEYS,PROMPT_OS,SCHEMA_OS,limparNumeroOS} from "./campos.js";
import {reduzir,b64} from "./imagem.js";
import {extrairCamposOCR} from "./ocrLocal.js";   // só a extração por rótulos (texto); o Tesseract não é usado aqui

function lerJSON(t){
  const s=String(t||"").replace(/```json/gi,"").replace(/```/g,"").trim();
  try{return JSON.parse(s)}catch{}
  const a=s.indexOf("{"),b=s.lastIndexOf("}");
  if(a>=0&&b>a)return JSON.parse(s.slice(a,b+1));
  throw new ErroApi("http","A resposta não veio em JSON.");
}
function normalizar(d){
  const o={};KEYS.forEach(k=>o[k]=String(d?.[k]??"").trim());
  o.numero_os=limparNumeroOS(o.numero_os);
  o.ocr_texto=String(d?.transcricao||"").trim();
  const inc=Array.isArray(d?.incertos)?d.incertos.filter(k=>KEYS.includes(k)):[];
  if(o.ocr_texto){const alt=extrairCamposOCR(o.ocr_texto);KEYS.forEach(k=>{if(!o[k]&&alt[k]){o[k]=alt[k];if(!inc.includes(k))inc.push(k)}})}
  KEYS.forEach(k=>{if(!o[k]&&!inc.includes(k))inc.push(k)});
  return{...o,incertos:inc};
}

function Aviso({srv,simples,onRetry}){
  if(srv.s==="online")return null;
  if(srv.s==="offline")return <div className="banner bad">{simples?"Sem conexão. Você pode preencher à mão.":"❌ Backend no Render não respondeu. Verifique se o serviço está ativo e se FRONTEND_ORIGIN (CORS) inclui este site."}<br/><button onClick={onRetry}>Tentar de novo</button></div>;
  return <div className="banner warn">{simples?"Conectando… aguarde.":"⏳ Acordando o servidor no Render (pode levar até 1 minuto)…"}</div>;
}

function Login({onOk}){
  const us=Core.users().filter(u=>u.ativo);
  const [id,setId]=useState(us[0]?.id||""),[pin,setPin]=useState(""),[err,setErr]=useState("");
  const entrar=async()=>{const r=await Core.login(id,pin);if(r.ok)onOk();else setErr(r.erro)};
  return <div className="card"><b>🔐 Entrar</b>
    <label>Usuário</label><select value={id} onChange={e=>setId(e.target.value)}>{us.map(u=><option key={u.id} value={u.id}>{u.nome} — {u.cargo}</option>)}</select>
    <label>PIN</label><input type="password" inputMode="numeric" maxLength={8} value={pin} onChange={e=>setPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&entrar()}/>
    <div className="err">{err}</div><button onClick={entrar}>Entrar</button>
    <div className="mut" style={{marginTop:10}}>Sem acesso? Peça ao administrador.</div></div>;
}

function Nova({srv,simples,edit,ligar,onSaved}){
  const [d,setD]=useState(edit||{}),[inc,setInc]=useState([]),[foto,setFoto]=useState(null);
  const [msg,setMsg]=useState(""),[busy,setBusy]=useState(false),[txt,setTxt]=useState("");
  const cam=useRef(),gal=useRef();
  const escolher=async f=>{if(!f)return;try{const b=await reduzir(f);setFoto({blob:b,url:URL.createObjectURL(b)});setMsg("")}catch{setMsg(simples?"Não consegui abrir a foto.":"Falha ao abrir a imagem.")}};
  async function ler(){
    if(busy||!foto)return;setBusy(true);
    try{
      let st=srv;
      if(st.s!=="online"){setMsg(simples?"Conectando…":"⏳ Acordando o servidor…");st=await ligar();if(!st.ok)throw new ErroApi("rede","O backend no Render não respondeu.")}
      if(!st.ai)throw new ErroApi("ia_off","IA não configurada no servidor (GEMINI_API_KEY no Render).");
      setMsg(simples?"Lendo a foto…":"🤖 Lendo a foto da OS...");
      const data=await b64(foto.blob);
      const t=await gem([{type:"text",text:PROMPT_OS},{type:"image",data,mime_type:foto.blob.type||"image/jpeg"}],SCHEMA_OS);
      const n=normalizar(lerJSON(t));setD(n);setInc(n.incertos);setTxt(n.ocr_texto);
      setMsg(simples?(n.incertos.length?"Pronto. Confira os campos em amarelo.":"Pronto. Confira e salve."):"✅ Foto lida."+(n.incertos.length?" ⚠️ "+n.incertos.length+" campo(s) para conferir.":" Confira antes de salvar."));
    }catch(e){console.error(e);setMsg("❌ "+erroAmigavel(e,simples)+(simples?"":" Preencha manualmente se preferir."))}
    finally{setBusy(false)}
  }
  async function salvar(){
    const u=Core.usuario(),rec=Core.regs(),ex=edit?rec.find(x=>x.id===edit.id):null;
    if(!ex&&!Core.can("criar_os"))return setMsg("Seu cargo não pode cadastrar OS.");
    if(ex&&!Core.can("editar_os"))return setMsg("Seu cargo não pode editar OS.");
    const o=ex?{...ex}:{id:"os_"+Date.now(),criado:new Date().toISOString(),usuario:u?u.nome:"",usuario_id:u?u.id:""};
    KEYS.forEach(k=>o[k]=(d[k]||"").trim());
    if(!o.numero_os&&!o.equipamento)return setMsg("Informe o número da ordem ou o equipamento.");
    if(foto){await Core.fotoPut(o.id,foto.blob);o.foto=true}else if(!ex)o.foto=false;
    if(ex){o.editado=new Date().toISOString();o.editado_por=u?u.nome:"";rec[rec.findIndex(x=>x.id===ex.id)]=o}else rec.unshift(o);
    if(!Core.saveRegs(rec))return setMsg("Não consegui salvar.");
    onSaved(ex?"✅ OS atualizada.":"✅ OS salva.");
  }
  const podeIA=Core.can("usar_ia");
  return <div className="card"><b>{edit?"Editar OS":"Nova OS"}</b>
    <div className="mut">{msg||"Preencha à mão ou tire uma foto."}</div>
    <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e=>escolher(e.target.files[0])}/>
    <input ref={gal} type="file" accept="image/*" hidden onChange={e=>escolher(e.target.files[0])}/>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <button onClick={()=>cam.current.click()}>📷 TIRAR FOTO</button>
      <button className="sec" onClick={()=>gal.current.click()}>🖼️ GALERIA</button></div>
    {!simples&&<div className="mut" style={{marginTop:8}}>Dica: foto de cima, folha inteira e reta, boa luz.</div>}
    {foto&&<img className="prev" src={foto.url} alt="Foto da OS"/>}
    {podeIA&&<button disabled={!foto||busy} onClick={ler}>{busy?"⏳ AGUARDE...":"🤖 LER E PREENCHER"}</button>}
    <hr style={{border:0,borderTop:"1px solid var(--bd)",margin:"16px 0"}}/>
    <div className="grid">{CAMPOS.map(([k,l])=>{
      const p={value:d[k]||"",placeholder:l,className:inc.includes(k)?"low":"",onChange:e=>setD({...d,[k]:e.target.value})};
      return <div key={k} style={LONG.includes(k)?{gridColumn:"1/-1"}:{}}><label>{l}{inc.includes(k)?" ⚠️ conferir":""}</label>{LONG.includes(k)?<textarea {...p}/>:<input {...p}/>}</div>})}</div>
    {!simples&&txt&&<details><summary>Ver texto lido da foto</summary><pre>{txt}</pre></details>}
    <button onClick={salvar}>✅ SALVAR</button>
  </div>;
}

function Linha({r,onEdit,onDel}){
  const [url,setUrl]=useState("");
  useEffect(()=>{let u="";if(r.foto)Core.fotoGet(r.id).then(b=>{if(b){u=URL.createObjectURL(b);setUrl(u)}});return()=>u&&URL.revokeObjectURL(u)},[r.id,r.foto]);
  return <div className="row"><b>OS {r.numero_os||"—"}</b> <span className="mut">{r.equipamento}</span>
    <div>{r.servico_solicitado}</div><div className="mut">{[r.executante,r.tipo_manutencao,r.usuario].filter(Boolean).join(" · ")}</div>
    {url&&<img className="prev" src={url} alt=""/>}
    {Core.can("editar_os")&&<button className="sec" onClick={()=>onEdit(r)}>Editar</button>}
    {Core.can("excluir_os")&&<button className="del" onClick={()=>onDel(r)}>Excluir</button>}</div>;
}

export default function App(){
  const [,tick]=useState(0),refresh=()=>tick(n=>n+1);
  const [tab,setTab]=useState("nova"),[edit,setEdit]=useState(null),[aviso,setAviso]=useState(""),[q,setQ]=useState("");
  const [srv,setSrv]=useState({s:"acordando",ai:false});
  const ligar=async()=>{setSrv(p=>({...p,s:"acordando"}));const r=await acordar((s,i)=>setSrv(p=>({s,ai:i?.ai??p.ai})));return r};
  useEffect(()=>{ligar()},[]);
  useEffect(()=>{Core.iniciarTema()},[]);
  const u=Core.usuario(),simples=!!u&&u.nivel<=1;
  if(Core.exigeLogin())return <><Cab/><main><Login onOk={refresh}/></main></>;
  const regs=Core.regs(),vis=(Core.aberto()||Core.can("ver_historico"))?regs:regs.filter(r=>u&&r.usuario_id===u.id);
  const busca=q.trim().toLowerCase(),achados=busca?vis.filter(r=>JSON.stringify(r).toLowerCase().includes(busca)):[];
  const del=async r=>{if(!confirm("Excluir esta OS?"))return;Core.saveRegs(Core.regs().filter(x=>x.id!==r.id));Core.fotoDel(r.id);refresh()};
  const exportar=()=>{if(!vis.length)return;const ws=XLSX.utils.json_to_sheet(vis.map(r=>{const x={};CAMPOS.forEach(([k,l])=>x[l]=r[k]||"");x["Registrado por"]=r.usuario||"";x["Registrado em"]=r.criado;return x}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"OS");XLSX.writeFile(wb,"historico_os.xlsx")};
  const conta=(f)=>Object.entries(vis.reduce((a,r)=>{const k=f(r)||"—";a[k]=(a[k]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const TABS=[["nova","📷","Nova OS","criar_os"],["pesq","🔎","Pesquisa","pesquisar"],["hist","📊","Histórico",null],["dash","📈","Painel","dashboard"],["conta","👤","Conta",null]].filter(t=>!t[3]||Core.can(t[3]));
  return <>
    <Cab u={u} simples={simples}/>
    <main>
      <Aviso srv={srv} simples={simples} onRetry={ligar}/>
      {aviso&&<div className="banner">{aviso}</div>}
      {tab==="nova"&&<Nova key={edit?.id||"novo"} srv={srv} simples={simples} edit={edit} ligar={ligar} onSaved={m=>{setEdit(null);setAviso(m);setTab("hist")}}/>}
      {tab==="pesq"&&<div className="card"><b>🔎 Pesquisa</b><input placeholder="Ordem, equipamento, serviço..." value={q} onChange={e=>setQ(e.target.value)}/>
        {busca?(achados.length?achados.map(r=><Linha key={r.id} r={r} onEdit={x=>{setEdit(x);setTab("nova")}} onDel={del}/>):<p className="mut">Nada encontrado.</p>):<p className="mut">Digite para buscar.</p>}</div>}
      {tab==="hist"&&<div className="card"><b>📊 Histórico</b>{vis.length?vis.map(r=><Linha key={r.id} r={r} onEdit={x=>{setEdit(x);setTab("nova")}} onDel={del}/>):<p className="mut">Nenhuma OS ainda.</p>}
        {Core.can("exportar")&&<button className="sec" onClick={exportar}>Exportar Excel</button>}</div>}
      {tab==="dash"&&<div className="card"><b>📈 Painel</b><div className="kpis" style={{marginTop:8}}><div className="kpi"><b>{vis.length}</b>OS</div><div className="kpi"><b>{new Set(vis.map(r=>r.equipamento).filter(Boolean)).size}</b>Equipamentos</div></div>
        <label>Por tipo</label>{conta(r=>r.tipo_manutencao).map(([k,n])=><div key={k} className="row">{k}: <b>{n}</b></div>)}
        <label>Por executante</label>{conta(r=>r.executante).map(([k,n])=><div key={k} className="row">{k}: <b>{n}</b></div>)}</div>}
      {tab==="conta"&&<div className="card"><b>👤 Conta</b>
        {u?<div className="mut">{u.nome}{!simples&&<> · {u.cargo} (nível {u.nivel})</>}</div>:<div className="mut">Acesso livre. Crie usuários no <a className="lk" href="admin.html">painel administrador</a>.</div>}
        <div className="mut" style={{marginTop:8}}>Leitura por foto: {srv.s==="online"?(srv.ai?"🟢 disponível":"🔴 indisponível"):"⏳ conectando"}</div>
        {!simples&&u&&<div className="mut" style={{marginTop:8}}><b>Permissões:</b> {Core.PERMS.filter(([k])=>Core.can(k)).map(p=>p[1]).join(" · ")}</div>}
        {Core.can("painel_admin")&&<a className="lk" href="admin.html">Painel administrador</a>}
        {u&&<button className="sec" onClick={()=>{Core.logout();setEdit(null);refresh()}}>Sair</button>}</div>}
    </main>
    <nav>{TABS.map(([k,i,l])=><a key={k} className={tab===k?"on":""} onClick={()=>{setAviso("");if(k==="nova")setEdit(null);setTab(k)}}><b>{i}</b>{l}</a>)}</nav>
  </>;
}
function Cab({u,simples}){
  return <header><img alt="Açoforja" src="logo.png"/><div className="t">Gestão Inteligente de OS{u&&!simples&&<small>{u.nome} · {u.cargo}</small>}</div>
    <button className="tema" onClick={()=>{Core.alternarTema()}}>🌓</button></header>;
}
