/* core.js — usuários, cargos, permissões, manuais e busca, compartilhados
   entre index.html (usuário) e admin.html (administrador).
   ATENÇÃO: tudo fica no navegador deste aparelho (localStorage / IndexedDB). O PIN impede uso casual,
   mas NÃO é segurança de servidor: quem abre as ferramentas do navegador consegue alterar os dados. */

/* Anti-clickjacking: se a página for aberta dentro de um iframe de outro site, não mostra nada. */
(function(){
  try{
    if(typeof window!=="undefined"&&window.top!==window.self){
      try{window.top.location=window.location.href}catch(e){}
      document.documentElement.innerHTML="";
    }
  }catch(e){}
})();

const Core=(()=>{
const LS={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}},
  del(k){try{localStorage.removeItem(k)}catch(e){}}
};
/* sessão só na aba (fecha o navegador = sai) */
const SS={
  get(k,d){try{const v=sessionStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{sessionStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}},
  del(k){try{sessionStorage.removeItem(k)}catch(e){}}
};
const esc=s=>String(s??"").replace(/[&<>"'`]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36);

/* ---------- sanitização (tudo que entra do armazenamento ou de arquivo passa por aqui) ---------- */
const ID_RE=/^[A-Za-z0-9_-]{1,64}$/;
const str=(v,max)=>v==null?"":String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"").slice(0,max);
const iso=v=>{const s=str(v,40);return /^[0-9TZ:+.\- ]*$/.test(s)?s:""};
const inteiro=(v,min,max,pad)=>{const n=parseInt(v,10);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):pad};
const CAMPOS_REG=["numero_os","equipamento","servico_solicitado","executante","tipo_manutencao","observacoes"];
function limpaReg(r){
  if(!r||typeof r!=="object"||Array.isArray(r))return null;
  const id=String(r.id==null?"":r.id);if(!ID_RE.test(id))return null;
  const o={id};
  CAMPOS_REG.forEach(k=>{o[k]=str(r[k],4000)});
  o.criado=iso(r.criado);
  o.usuario=str(r.usuario,80);
  o.usuario_id=ID_RE.test(String(r.usuario_id||""))?String(r.usuario_id):"";
  o.foto=!!r.foto;
  if(r.editado){o.editado=iso(r.editado);o.editado_por=str(r.editado_por,80)}
  return o;
}
function limpaUser(u){
  if(!u||typeof u!=="object"||Array.isArray(u))return null;
  const id=String(u.id==null?"":u.id);if(!ID_RE.test(id))return null;
  const nome=str(u.nome,60).trim(),cargo=str(u.cargo,60).trim(),salt=String(u.salt||""),hash=String(u.hash||"");
  if(!nome||!cargo||!/^[A-Za-z0-9]{8,64}$/.test(salt)||!/^[pcs]:[A-Za-z0-9:]{4,200}$/.test(hash))return null;
  return{id,nome,cargo,salt,hash,ativo:!!u.ativo,criado:iso(u.criado)};
}

/* ---------- permissões e cargos ---------- */
const PERMS=[
  ["criar_os","Cadastrar OS"],
  ["usar_ia","Ler foto com IA (Gemini)"],
  ["pesquisar","Pesquisar histórico"],
  ["ver_historico","Ver OS de todos os usuários"],
  ["editar_os","Editar OS"],
  ["excluir_os","Excluir OS"],
  ["exportar","Exportar Excel"],
  ["dashboard","Ver Dashboard"],
  ["consultar_ia","Assistente: consultar também o histórico de OS"],
  ["painel_admin","Acessar o painel administrador"],
  ["perguntar_ia","Assistente de IA (perguntas livres)"],
  ["consultar_manuais","Consultar manuais (planilhas)"]
];
const TODAS=PERMS.map(p=>p[0]);
const PADRAO=[
  {nome:"Estagiário",nivel:1,perms:["criar_os","usar_ia","pesquisar","perguntar_ia","consultar_manuais"]},
  {nome:"Técnico",nivel:2,perms:["criar_os","usar_ia","pesquisar","ver_historico","exportar","perguntar_ia","consultar_manuais"]},
  {nome:"Supervisor",nivel:3,perms:["criar_os","usar_ia","pesquisar","ver_historico","editar_os","exportar","dashboard","consultar_ia","perguntar_ia","consultar_manuais"]},
  {nome:"Administrador",nivel:99,fixo:true,perms:TODAS.slice()}
];
function limpaCargo(c){
  if(!c||typeof c!=="object"||Array.isArray(c))return null;
  const nome=str(c.nome,60).trim();if(!nome)return null;
  const perms=[...new Set((Array.isArray(c.perms)?c.perms:[]).map(String).filter(p=>TODAS.includes(p)))];
  return{nome,nivel:inteiro(c.nivel,1,99,1),fixo:!!c.fixo,perms};
}
function cargos(){
  let c=LS.get("os_cargos",null);
  if(!Array.isArray(c)||!c.length){c=JSON.parse(JSON.stringify(PADRAO));LS.set("os_cargos",c);LS.set("os_cargos_v",2)}
  else if(LS.get("os_cargos_v",1)<2){
    // migração: os cargos padrão ganham as duas permissões novas (cargos personalizados ficam como estão)
    c.forEach(x=>{if(x&&["Estagiário","Técnico","Supervisor"].includes(x.nome)&&Array.isArray(x.perms)){["perguntar_ia","consultar_manuais"].forEach(p=>{if(!x.perms.includes(p))x.perms.push(p)})}});
    LS.set("os_cargos",c);LS.set("os_cargos_v",2);
  }
  c=c.map(limpaCargo).filter(Boolean);
  let adm=c.find(x=>x.fixo);
  if(!adm){adm={nome:"Administrador",nivel:99,fixo:true,perms:[]};c.push(adm)}
  adm.perms=TODAS.slice();adm.nivel=99;      // o Administrador sempre tem tudo
  return c;
}
const saveCargos=c=>{LS.set("os_cargos_v",2);return LS.set("os_cargos",c.map(limpaCargo).filter(Boolean))};
const permsDoCargo=nome=>(cargos().find(x=>x.nome===nome)||{perms:[]}).perms;

/* ---------- dados ---------- */
const lista=v=>Array.isArray(v)?v:[];
const users=()=>lista(LS.get("os_users",[])).map(limpaUser).filter(Boolean);
const saveUsers=u=>LS.set("os_users",u.map(limpaUser).filter(Boolean));
const regs=()=>lista(LS.get("os_regs",[])).map(limpaReg).filter(Boolean);
const saveRegs=r=>LS.set("os_regs",r.map(limpaReg).filter(Boolean));

/* ---------- PIN: PBKDF2-SHA256 com sal (formatos antigos continuam valendo e são migrados no login) ---------- */
const PBKDF2_IT=310000;
const hex=buf=>Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,"0")).join("");
const temSubtle=()=>typeof crypto!=="undefined"&&!!crypto.subtle&&typeof crypto.subtle.deriveBits==="function";
function cyrb(s){let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (4294967296*(2097151&h2)+(h1>>>0)).toString(16)}
function novoSal(){try{const a=new Uint8Array(12);crypto.getRandomValues(a);return hex(a)}catch(e){return uid()+uid()}}
async function pbkdf2(salt,pin,it){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",enc.encode(String(pin)),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:enc.encode("os-pin:"+salt),iterations:it},key,256);
  return hex(bits);
}
async function hashPin(salt,pin){          // hash NOVO (usado ao criar/redefinir PIN)
  if(temSubtle())return "p:"+PBKDF2_IT+":"+await pbkdf2(salt,pin,PBKDF2_IT);
  return "c:"+cyrb(salt+":"+pin);          // navegador sem criptografia (site fora de https): só uso casual
}
function iguais(a,b){a=String(a);b=String(b);let d=a.length^b.length;const n=Math.max(a.length,b.length);for(let i=0;i<n;i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0}
const pinValido=p=>/^\d{4,8}$/.test(String(p||""));
async function verificarPin(u,pin){
  const h=String(u.hash),tipo=h[0];
  let calc;
  if(tipo==="p"){
    const it=parseInt(h.split(":")[1],10);
    if(!(it>=1000&&it<=5000000))return{ok:false,legado:false};
    if(!temSubtle())throw new Error("Este navegador não consegue verificar o PIN (abra o site por https).");
    calc="p:"+it+":"+await pbkdf2(u.salt,pin,it);
  }else if(tipo==="s"){
    if(!temSubtle())throw new Error("Este navegador não consegue verificar o PIN (abra o site por https).");
    const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(u.salt+":"+pin));
    calc="s:"+hex(b);
  }else calc="c:"+cyrb(u.salt+":"+pin);
  return{ok:iguais(calc,h),legado:tipo!=="p"};
}

/* ---------- tentativas (bloqueio progressivo) e sessão ---------- */
const tentativas=()=>LS.get("os_tent",{});
const bloqueio=id=>{const t=tentativas()[id];return t&&t.ate&&t.ate>Date.now()?Math.ceil((t.ate-Date.now())/1000):0};
function falha(id){
  const all=tentativas();const t=all[id]||{n:0,lv:0};
  t.n=(t.n||0)+1;
  if(t.n>=5){t.lv=Math.min((t.lv||0)+1,5);t.ate=Date.now()+Math.min(30*Math.pow(2,t.lv-1),900)*1000;t.n=0}  // 30s, 1min, 2min, 4min, 8min
  all[id]=t;LS.set("os_tent",all);
}
function tentOk(id){const all=tentativas();delete all[id];LS.set("os_tent",all)}
LS.del("os_sess");   // sessão antiga (guardada no aparelho todo) deixa de valer
async function login(id,pin){
  const us=users(),u=us.find(x=>x.id===String(id));
  if(!u||!u.ativo)return{ok:false,erro:"Usuário inativo ou inexistente."};
  const b=bloqueio(u.id);if(b)return{ok:false,erro:"Muitas tentativas. Aguarde "+b+"s."};
  let v;
  try{v=await verificarPin(u,String(pin))}catch(e){return{ok:false,erro:e.message}}
  if(!v.ok){falha(u.id);return{ok:false,erro:"PIN incorreto."}}
  tentOk(u.id);
  if(v.legado&&temSubtle()){u.salt=novoSal();u.hash=await hashPin(u.salt,String(pin));saveUsers(us)}   // migra para PBKDF2
  SS.set("os_sess",{id:u.id,exp:Date.now()+8*3600*1000});
  return{ok:true};
}
const logout=()=>{SS.del("os_sess");LS.del("os_sess")};
function usuario(){
  const s=SS.get("os_sess",null);
  if(!s||!s.id||!(s.exp>Date.now()))return null;
  const u=users().find(x=>x.id===s.id&&x.ativo);
  if(!u)return null;
  const c=cargos().find(x=>x.nome===u.cargo)||{nivel:0,perms:[]};
  return{id:u.id,nome:u.nome,cargo:u.cargo,nivel:c.nivel,perms:c.perms};
}
const aberto=()=>users().length===0;                  // sem usuários = acesso livre (como era antes)
const exigeLogin=()=>!aberto()&&!usuario();
function can(p){if(aberto())return true;const u=usuario();return !!u&&u.perms.includes(p)}
const adminsAtivos=(exceto)=>users().filter(u=>u.ativo&&u.id!==exceto&&permsDoCargo(u.cargo).includes("painel_admin"));

/* ---------- gestão de usuários ---------- */
async function criarUsuario({nome,cargo,pin}){
  nome=str(nome,60).trim();
  if(!nome)return{ok:false,erro:"Informe o nome."};
  if(!pinValido(pin))return{ok:false,erro:"O PIN deve ter de 4 a 8 números."};
  if(!cargos().some(c=>c.nome===cargo))return{ok:false,erro:"Cargo inválido."};
  const us=users();
  if(us.some(u=>u.nome.toLowerCase()===nome.toLowerCase()))return{ok:false,erro:"Já existe um usuário com esse nome."};
  const salt=novoSal();
  const u={id:uid(),nome,cargo,salt,hash:await hashPin(salt,String(pin)),ativo:true,criado:new Date().toISOString()};
  us.push(u);saveUsers(us);
  return{ok:true,user:u};
}
async function definirPin(id,pin){
  if(!pinValido(pin))return{ok:false,erro:"O PIN deve ter de 4 a 8 números."};
  const us=users();const u=us.find(x=>x.id===id);
  if(!u)return{ok:false,erro:"Usuário não encontrado."};
  u.salt=novoSal();u.hash=await hashPin(u.salt,String(pin));saveUsers(us);tentOk(id);
  return{ok:true};
}

/* ---------- backup (exportar / importar) ---------- */
function exportarBackup(){return{versao:2,exportado:new Date().toISOString(),os_regs:regs(),os_users:users(),os_cargos:cargos()}}
function importarBackup(d){
  if(!d||typeof d!=="object"||!Array.isArray(d.os_regs))throw new Error("arquivo inválido");
  let nr=0,nu=0,nc=0,ign=0,admInativos=0;
  const rs=regs(),ids=new Set(rs.map(r=>r.id));
  d.os_regs.slice(0,200000).forEach(x=>{const r=limpaReg(x);if(!r){ign++;return}if(ids.has(r.id))return;rs.push(r);ids.add(r.id);nr++});
  saveRegs(rs);
  // cargos importados nunca recebem "acessar o painel administrador"
  const cs=cargos(),cn=new Set(cs.map(c=>c.nome.toLowerCase()));
  lista(d.os_cargos).slice(0,200).forEach(x=>{const c=limpaCargo(x);if(!c||c.fixo||cn.has(c.nome.toLowerCase()))return;c.nivel=Math.min(c.nivel,98);c.perms=c.perms.filter(p=>p!=="painel_admin");cs.push(c);cn.add(c.nome.toLowerCase());nc++});
  saveCargos(cs);
  // usuários importados que seriam administradores entram INATIVOS (evita criar um acesso de administrador escondido)
  const us=users(),uids=new Set(us.map(u=>u.id)),nomes=new Set(us.map(u=>u.nome.toLowerCase()));
  lista(d.os_users).slice(0,500).forEach(x=>{
    const u=limpaUser(x);if(!u){ign++;return}
    if(uids.has(u.id)||nomes.has(u.nome.toLowerCase()))return;
    if(!cs.some(c=>c.nome===u.cargo))u.cargo=cs.some(c=>c.nome==="Estagiário")?"Estagiário":null;
    if(!u.cargo){ign++;return}
    if(permsDoCargo(u.cargo).includes("painel_admin")||(cs.find(c=>c.nome===u.cargo)||{}).fixo){if(u.ativo)admInativos++;u.ativo=false}
    us.push(u);uids.add(u.id);nomes.add(u.nome.toLowerCase());nu++;
  });
  saveUsers(us);
  return{nr,nu,nc,ign,admInativos};
}

/* ---------- fotos (IndexedDB) ---------- */
let db=null;
const dbReady=new Promise(r=>{try{const q=indexedDB.open("os_fotos",1);q.onupgradeneeded=()=>q.result.createObjectStore("f");q.onsuccess=()=>{db=q.result;r()};q.onerror=()=>r()}catch(e){r()}});
const fotoPut=async(id,b)=>{await dbReady;if(!db)return;return new Promise(r=>{try{const t=db.transaction("f","readwrite");t.objectStore("f").put(b,id);t.oncomplete=r;t.onerror=r}catch(e){r()}})};
const fotoGet=async id=>{await dbReady;if(!db)return null;return new Promise(r=>{try{const q=db.transaction("f").objectStore("f").get(id);q.onsuccess=()=>r(q.result||null);q.onerror=()=>r(null)}catch(e){r(null)}})};
const fotoDel=async id=>{await dbReady;if(!db)return;try{db.transaction("f","readwrite").objectStore("f").delete(id)}catch(e){}};

/* =====================================================================
   MANUAIS (planilhas) — guardados em IndexedDB neste aparelho
   ===================================================================== */
const LIM={abas:20,linhas:60000,colunas:60,celula:300,arquivoMB:15,pacoteMB:80};
function limpaAbas(abas){
  let total=0;const out=[];
  lista(abas).slice(0,LIM.abas).forEach(a=>{
    if(!a||typeof a!=="object")return;
    const cab=lista(a.cab).slice(0,LIM.colunas).map(x=>str(x,120).trim());
    const linhas=[];
    for(const r of lista(a.linhas)){
      if(total>=LIM.linhas)break;
      const l=lista(r).slice(0,LIM.colunas).map(x=>str(x,LIM.celula).trim());
      if(l.some(x=>x)){linhas.push(l);total++}
    }
    out.push({nome:str(a.nome,80).trim()||"Aba",cab,linhas});
  });
  return out;
}
function limpaManualMeta(m){
  if(!m||typeof m!=="object"||Array.isArray(m))return null;
  const id=String(m.id==null?"":m.id);if(!ID_RE.test(id))return null;
  const nome=str(m.nome,120).trim();if(!nome)return null;
  return{id,nome,arquivo:str(m.arquivo,200),nota:str(m.nota,400),ativo:m.ativo!==false,criado:iso(m.criado),atualizado:iso(m.atualizado),por:str(m.por,80),
    nAbas:inteiro(m.nAbas,0,LIM.abas,0),nLinhas:inteiro(m.nLinhas,0,LIM.linhas,0)};
}
let mdb=null;
const mdbOpen=()=>mdb?Promise.resolve(mdb):new Promise((res,rej)=>{
  try{const q=indexedDB.open("os_manuais",1);
    q.onupgradeneeded=()=>{const d=q.result;d.createObjectStore("meta",{keyPath:"id"});d.createObjectStore("dados",{keyPath:"id"})};
    q.onsuccess=()=>{mdb=q.result;res(mdb)};
    q.onerror=()=>rej(q.error||new Error("IndexedDB indisponível neste navegador"));
  }catch(e){rej(e)}
});
const reqP=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const txDone=t=>new Promise((res,rej)=>{t.oncomplete=()=>res();t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error("gravação cancelada"))});
const Manuais={
  async lista(){
    const d=await mdbOpen();
    const all=await reqP(d.transaction("meta").objectStore("meta").getAll());
    return all.map(limpaManualMeta).filter(Boolean).sort((a,b)=>String(b.atualizado).localeCompare(String(a.atualizado)));
  },
  async get(id){
    if(!ID_RE.test(String(id)))return null;
    const d=await mdbOpen();const t=d.transaction(["meta","dados"]);
    const [m,x]=await Promise.all([reqP(t.objectStore("meta").get(String(id))),reqP(t.objectStore("dados").get(String(id)))]);
    const meta=limpaManualMeta(m);if(!meta||!x)return null;
    return{...meta,abas:limpaAbas(x.abas)};
  },
  async salvar(meta,abas){
    abas=limpaAbas(abas);
    const m=limpaManualMeta({...meta,nAbas:abas.length,nLinhas:abas.reduce((s,a)=>s+a.linhas.length,0),atualizado:new Date().toISOString()});
    if(!m)throw new Error("manual inválido");
    const d=await mdbOpen();const t=d.transaction(["meta","dados"],"readwrite");
    t.objectStore("meta").put(m);t.objectStore("dados").put({id:m.id,abas});
    await txDone(t);return m;
  },
  async patch(id,p){
    const d=await mdbOpen();const t=d.transaction("meta","readwrite");
    const atual=limpaManualMeta(await reqP(t.objectStore("meta").get(String(id))));
    if(!atual)throw new Error("manual não encontrado");
    const novo=limpaManualMeta({...atual,...p,id:atual.id});
    t.objectStore("meta").put(novo);await txDone(t);return novo;
  },
  async excluir(id){
    if(!ID_RE.test(String(id)))return;
    const d=await mdbOpen();const t=d.transaction(["meta","dados"],"readwrite");
    t.objectStore("meta").delete(String(id));t.objectStore("dados").delete(String(id));await txDone(t);
  }
};

/* ---------- leitura de planilhas: CSV próprio (sem biblioteca) e montagem de abas ---------- */
function lerCSV(texto){
  texto=String(texto||"").replace(/^﻿/,"");
  const cont={";":0,",":0,"\t":0,"|":0};let q=false,vistas=0;
  for(let i=0;i<texto.length&&vistas<6;i++){const ch=texto[i];if(ch==='"')q=!q;else if(!q){if(ch==="\n")vistas++;else if(ch in cont)cont[ch]++}}
  const sep=Object.keys(cont).sort((a,b)=>cont[b]-cont[a])[0];const SEP=cont[sep]>0?sep:",";
  const rows=[];let row=[],cel="",inQ=false;
  for(let i=0;i<texto.length;i++){
    const ch=texto[i];
    if(inQ){
      if(ch==='"'){if(texto[i+1]==='"'){cel+='"';i++}else inQ=false}else cel+=ch;
    }else if(ch==='"'&&cel==="")inQ=true;
    else if(ch===SEP){row.push(cel);cel=""}
    else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&texto[i+1]==="\n")i++;row.push(cel);cel="";if(row.some(x=>String(x).trim()))rows.push(row);row=[];if(rows.length>LIM.linhas+1)break}
    else cel+=ch;
  }
  if(cel!==""||row.length){row.push(cel);if(row.some(x=>String(x).trim()))rows.push(row)}
  return rows;
}
function montarAba(nome,matriz){
  const m=lista(matriz).map(r=>lista(r).map(x=>x==null?"":String(x)));
  let h=m.findIndex((r,i)=>i<10&&r.filter(x=>x.trim()).length>=2);if(h<0)h=0;
  return{nome:str(nome,80)||"Aba",cab:m[h]||[],linhas:m.slice(h+1)};
}

/* =====================================================================
   BUSCA local (sem IA): escolhe as linhas mais parecidas com a pergunta
   ===================================================================== */
const Busca=(()=>{
  const STOP=new Set(("a o as os um uma uns umas de do da dos das em no na nos nas num numa por para pra com sem e ou que se ao aos à às é são foi ser sao tem ter há ha como qual quais quando onde porque mais menos muito pouco já ja não nao sim isso isto esse essa este esta aquele aquela meu minha seu sua nosso nossa pode podem posso precisa preciso serve servem sera será seria usar usa usado compativel compatível compatibilidade peça peca peças pecas maquina máquina maquinas máquinas equipamento equipamentos qual quero saber the of for and to in on is are").split(/\s+/).map(w=>normS(w)));
  function normS(s){return String(s==null?"":s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
  const comp=s=>String(s==null?"":s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
  function termos(q){
    q=String(q||"").slice(0,1500);
    const palavras=[...new Set(normS(q).split(" ").filter(w=>w&&!STOP.has(w)&&(w.length>=2||/\d/.test(w))))].slice(0,16);
    const codigos=[...new Set((q.match(/[A-Za-z0-9][A-Za-z0-9\-\/._]*[A-Za-z0-9]/g)||[]).filter(c=>/\d/.test(c)&&/[-\/._]/.test(c)&&comp(c).length>=3).map(comp))].slice(0,6);
    return{palavras,codigos};
  }
  function preparar(doc){
    if(doc._p)return doc._p;
    const p=doc.abas.map(a=>({ln:a.linhas.map(r=>" "+normS(r.join(" "))+" "),lc:a.linhas.map(r=>r.map(comp).join("|"))}));
    Object.defineProperty(doc,"_p",{value:p,enumerable:false,configurable:true});
    return p;
  }
  function buscar(docs,q,K){
    K=K||25;
    const T=termos(q);
    if(!T.palavras.length&&!T.codigos.length)return{itens:[],termos:T,total:0,candidatos:0};
    let N=0;const df=new Map();T.palavras.forEach(w=>df.set(w,0));T.codigos.forEach(c=>df.set("#"+c,0));
    const cand=[];
    lista(docs).forEach(doc=>{
      const P=preparar(doc);
      doc.abas.forEach((a,ai)=>{
        const {ln,lc}=P[ai];
        for(let i=0;i<ln.length;i++){
          N++;const hits=[];
          for(const w of T.palavras){if(ln[i].includes(" "+w)){hits.push(w);df.set(w,df.get(w)+1)}}
          for(const c of T.codigos){if(lc[i].includes(c)){hits.push("#"+c);df.set("#"+c,df.get("#"+c)+1)}}
          if(hits.length)cand.push({doc,ai,i,hits});
        }
      });
    });
    const total=T.palavras.length+T.codigos.length;
    const idf=k=>Math.log(1+(N+1)/(1+(df.get(k)||0)));
    cand.forEach(c=>{let s=0;c.hits.forEach(k=>{s+=idf(k)*(k[0]==="#"?2.5:1)});c.score=s*(1+c.hits.length/total)});
    cand.sort((a,b)=>b.score-a.score);
    return{itens:cand.slice(0,K),termos:T,total:N,candidatos:cand.length};
  }
  function linhaTexto(doc,ai,i,max){
    max=max||700;const a=doc.abas[ai],r=a.linhas[i]||[],partes=[];
    for(let c=0;c<r.length;c++){const v=String(r[c]||"").trim();if(!v)continue;partes.push((a.cab[c]||("col"+(c+1)))+": "+v)}
    const t=partes.join("; ");return t.length>max?t.slice(0,max)+"…":t;
  }
  const ref=(doc,ai,i)=>doc.nome+" › "+doc.abas[ai].nome+" › item "+(i+1);
  return{termos,buscar,linhaTexto,ref,norm:normS,comp};
})();

/* ---------- tema claro/escuro (compartilhado) ---------- */
function aplicarTema(t){
  document.documentElement.setAttribute("data-theme",t);
  const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="light"?"#ffffff":"#000000";
  const b=document.getElementById("tema");if(b){b.textContent=t==="light"?"🌙":"☀️";b.title=t==="light"?"Mudar para tema escuro":"Mudar para tema claro"}
}
const temaAtual=()=>document.documentElement.getAttribute("data-theme")==="light"?"light":"dark";
function alternarTema(){const n=temaAtual()==="light"?"dark":"light";try{localStorage.setItem("os_tema",n)}catch(e){}aplicarTema(n)}
function iniciarTema(){let t="dark";try{t=localStorage.getItem("os_tema")==="light"?"light":"dark"}catch(e){}aplicarTema(t)}

return{LS,esc,uid,PERMS,TODAS,cargos,saveCargos,permsDoCargo,users,saveUsers,regs,saveRegs,
  hashPin,pinValido,login,logout,usuario,aberto,exigeLogin,can,adminsAtivos,bloqueio,
  criarUsuario,definirPin,exportarBackup,importarBackup,fotoPut,fotoGet,fotoDel,
  Manuais,Busca,LIM,lerCSV,montarAba,sanit:{reg:limpaReg,user:limpaUser,cargo:limpaCargo,manual:limpaManualMeta,abas:limpaAbas,ID_RE,str},
  aplicarTema,temaAtual,alternarTema,iniciarTema};
})();
