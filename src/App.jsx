import {useState,useEffect,useRef} from "react";
import {regs as lerRegs,excluirOS,iniciarTema,exportarBackup,importarBackup,getToken,setToken} from "./store.js";
import {sincronizar,configurado,resetarAuth} from "./sync.js";
import {acordar} from "./api.js";
import {CAMPOS} from "./campos.js";
import Cab from "./components/Cab.jsx";
import Aviso from "./components/Aviso.jsx";
import Nova from "./components/Nova.jsx";
import Linha from "./components/Linha.jsx";

const TABS=[["nova","📷","Nova OS"],["pesq","🔎","Pesquisa"],["hist","📊","Histórico"],["dash","📈","Painel"],["cfg","⚙️","Ajustes"]];
const PAGINA=30;
const baixar=(nome,blob)=>{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=nome;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)};

export default function App(){
  const [,tick]=useState(0),refresh=()=>tick(n=>n+1);
  const [tab,setTab]=useState("nova"),[edit,setEdit]=useState(null),[aviso,setAviso]=useState(""),[q,setQ]=useState(""),[lim,setLim]=useState(PAGINA);
  const [srv,setSrv]=useState({s:"acordando",ai:false,sync:false,auth:false});
  const [nuvem,setNuvem]=useState({s:"off"}),[chave,setChave]=useState("");
  const arq=useRef(),ultimo=useRef(0);
  const ligar=async()=>{setSrv(p=>({...p,s:"acordando"}));return acordar((s,i)=>setSrv(p=>({s,ai:i?.ai??p.ai,sync:i?.sync??p.sync,auth:i?.auth??p.auth})))};
  const sync=async()=>{
    if(!configurado()){setNuvem({s:"off"});return}
    setNuvem(p=>({...p,s:"sinc"}));
    const r=await sincronizar();ultimo.current=Date.now();
    if(r.ok){setNuvem({s:"ok",quando:new Date()});if(r.mudou)refresh()}else setNuvem({s:"erro",msg:r.msg||"Falha"});
  };
  useEffect(()=>{ligar()},[]);
  useEffect(()=>{iniciarTema()},[]);
  useEffect(()=>{if(srv.s==="online"&&srv.sync)sync()},[srv.s,srv.sync]);                     // ao abrir
  useEffect(()=>{                                                                            // ao voltar para o app (celular <-> PC)
    const f=()=>{if(document.visibilityState==="visible"&&Date.now()-ultimo.current>60000)sync()};
    document.addEventListener("visibilitychange",f);return()=>document.removeEventListener("visibilitychange",f);
  },[]);

  const vis=lerRegs();
  const busca=q.trim().toLowerCase(),achados=busca?vis.filter(r=>JSON.stringify(r).toLowerCase().includes(busca)):[];
  const editar=r=>{setEdit(r);setTab("nova")};
  const del=async r=>{if(!confirm("Excluir esta OS?"))return;excluirOS(r.id);refresh();sync()};
  const exportar=async()=>{
    if(!vis.length)return;
    const XLSX=await import("xlsx");
    const ws=XLSX.utils.json_to_sheet(vis.map(r=>{const x={};CAMPOS.forEach(([k,l])=>x[l]=r[k]||"");x["Registrado em"]=r.criado;return x}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"OS");XLSX.writeFile(wb,"historico_os.xlsx");
  };
  const backup=()=>baixar("backup_os_"+new Date().toISOString().slice(0,10)+".json",new Blob([JSON.stringify(exportarBackup())],{type:"application/json"}));
  const salvarChave=()=>{setToken(chave);setChave("");resetarAuth();sync()};
  const restaurar=async f=>{
    if(!f)return;
    try{const r=importarBackup(JSON.parse(await f.text()));setAviso(`✅ Backup restaurado: ${r.novos} nova(s), ${r.atualizados} atualizada(s).`);refresh();sync()}
    catch(e){setAviso("❌ "+(e.message||"Não consegui ler o arquivo."))}
  };
  const conta=f=>Object.entries(vis.reduce((a,r)=>{const k=f(r)||"—";a[k]=(a[k]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]).slice(0,6);

  return <>
    <Cab nuvem={nuvem}/>
    <main>
      <Aviso srv={srv} onRetry={ligar}/>
      {aviso&&<div className="banner">{aviso}</div>}
      {tab==="nova"&&<Nova key={edit?.id||"novo"} srv={srv} edit={edit} ligar={ligar} onSaved={m=>{setEdit(null);setAviso(m);setLim(PAGINA);setTab("hist");sync()}}/>}
      {tab==="pesq"&&<div className="card"><b>🔎 Pesquisa</b><input placeholder="Ordem, equipamento, serviço..." value={q} onChange={e=>setQ(e.target.value)}/>
        {busca?(achados.length?achados.map(r=><Linha key={r.id} r={r} onEdit={editar} onDel={del}/>):<p className="mut">Nada encontrado.</p>):<p className="mut">Digite para buscar.</p>}</div>}
      {tab==="hist"&&<div className="card"><b>📊 Histórico</b>
        {vis.length?vis.slice(0,lim).map(r=><Linha key={r.id} r={r} onEdit={editar} onDel={del}/>):<p className="mut">Nenhuma OS ainda.</p>}
        {vis.length>lim&&<button className="sec" onClick={()=>setLim(l=>l+PAGINA)}>Mostrar mais ({vis.length-lim})</button>}
        {vis.length>0&&<button className="sec" onClick={exportar}>Exportar Excel</button>}</div>}
      {tab==="dash"&&<div className="card"><b>📈 Painel</b>
        <div className="kpis" style={{marginTop:8}}><div className="kpi"><b>{vis.length}</b>OS</div><div className="kpi"><b>{new Set(vis.map(r=>r.equipamento).filter(Boolean)).size}</b>Equipamentos</div></div>
        <label>Por tipo</label>{conta(r=>r.tipo_manutencao).map(([k,n])=><div key={k} className="row">{k}: <b>{n}</b></div>)}
        <label>Por executante</label>{conta(r=>r.executante).map(([k,n])=><div key={k} className="row">{k}: <b>{n}</b></div>)}
        <label>Por equipamento</label>{conta(r=>r.equipamento).map(([k,n])=><div key={k} className="row">{k}: <b>{n}</b></div>)}</div>}
      {tab==="cfg"&&<div className="card"><b>⚙️ Ajustes</b>
        <div className="mut" style={{marginTop:8}}>Leitura por foto: {srv.s==="online"?(srv.ai?"🟢 disponível":"🔴 indisponível (GEMINI_API_KEY no servidor)"):"⏳ conectando"}</div>
        <label>☁️ Nuvem — mesmo histórico no celular e no PC</label>
        {srv.s==="online"&&!srv.sync&&<div className="mut">Nuvem não está ligada no servidor (faltam TURSO_DATABASE_URL, TURSO_AUTH_TOKEN e APP_TOKEN no Render). Veja o LEIAME.</div>}
        {(srv.sync||configurado())&&<>
          <div className="mut">{configurado()?<>Chave de acesso neste aparelho: ✅ definida. Estado: {{off:"—",sinc:"⏳ sincronizando…",ok:"☁️ sincronizado às "+(nuvem.quando?.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})||""),erro:"⚠️ "+(nuvem.msg||"falha")}[nuvem.s]}</>:"Informe a chave de acesso (a mesma APP_TOKEN do servidor) para ligar a nuvem neste aparelho."}</div>
          <input type="password" autoComplete="off" placeholder={configurado()?"Trocar chave de acesso…":"Chave de acesso (APP_TOKEN)"} value={chave} onChange={e=>setChave(e.target.value)}/>
          <button disabled={chave.trim().length<16} onClick={salvarChave}>Salvar chave e sincronizar</button>
          {configurado()&&<button className="sec" onClick={()=>{resetarAuth();sync()}}>🔄 Sincronizar agora</button>}
          {configurado()&&<button className="sec" onClick={()=>{if(confirm("Remover a chave deste aparelho? Os dados daqui continuam, mas param de sincronizar."))   {setToken("");setNuvem({s:"off"});refresh()}}}>Desligar nuvem neste aparelho</button>}
        </>}
        <label>Backup em arquivo</label>
        <div className="mut">Cópia de segurança dos registros (sem fotos). Útil mesmo com a nuvem ligada.</div>
        <button onClick={backup}>⬇️ Baixar backup ({vis.length} OS)</button>
        <input ref={arq} type="file" accept="application/json,.json" hidden onChange={e=>{restaurar(e.target.files[0]);e.target.value=""}}/>
        <button className="sec" onClick={()=>arq.current.click()}>⬆️ Restaurar backup</button>
        <label>Outros</label>
        <a className="lk" href="admin.html">Painel antigo (manuais e peças)</a></div>}
    </main>
    <nav>{TABS.map(([k,i,l])=><a key={k} role="button" tabIndex={0} className={tab===k?"on":""} onClick={()=>{setAviso("");if(k==="nova")setEdit(null);setTab(k)}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")e.currentTarget.click()}}><b>{i}</b>{l}</a>)}</nav>
  </>;
}
