/* core.js — usuários, cargos, permissões e armazenamento compartilhados
   entre index.html (usuário) e admin.html (administrador).
   ATENÇÃO: tudo fica no navegador deste aparelho (localStorage). O PIN impede uso casual,
   mas NÃO é segurança de servidor: quem abre as ferramentas do navegador consegue alterar os dados. */
const Core=(()=>{
const LS={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}},
  del(k){try{localStorage.removeItem(k)}catch(e){}}
};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36);

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
  ["consultar_ia","Perguntar à IA sobre o histórico"],
  ["painel_admin","Acessar o painel administrador"]
];
const TODAS=PERMS.map(p=>p[0]);
const PADRAO=[
  {nome:"Estagiário",nivel:1,perms:["criar_os","usar_ia","pesquisar"]},
  {nome:"Técnico",nivel:2,perms:["criar_os","usar_ia","pesquisar","ver_historico","exportar"]},
  {nome:"Supervisor",nivel:3,perms:["criar_os","usar_ia","pesquisar","ver_historico","editar_os","exportar","dashboard","consultar_ia"]},
  {nome:"Administrador",nivel:99,fixo:true,perms:TODAS.slice()}
];
function cargos(){
  let c=LS.get("os_cargos",null);
  if(!Array.isArray(c)||!c.length){c=JSON.parse(JSON.stringify(PADRAO));LS.set("os_cargos",c)}
  let adm=c.find(x=>x.fixo);
  if(!adm){adm={nome:"Administrador",nivel:99,fixo:true,perms:[]};c.push(adm)}
  adm.perms=TODAS.slice();adm.nivel=99;      // o Administrador sempre tem tudo
  return c;
}
const saveCargos=c=>LS.set("os_cargos",c);
const permsDoCargo=nome=>(cargos().find(x=>x.nome===nome)||{perms:[]}).perms;

/* ---------- dados ---------- */
const users=()=>LS.get("os_users",[]);
const saveUsers=u=>LS.set("os_users",u);
const regs=()=>LS.get("os_regs",[]);
const saveRegs=r=>LS.set("os_regs",r);

/* ---------- PIN (hash com sal) ---------- */
function cyrb(s){let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (4294967296*(2097151&h2)+(h1>>>0)).toString(16)}
function novoSal(){try{const a=new Uint8Array(12);crypto.getRandomValues(a);return Array.from(a).map(x=>x.toString(16).padStart(2,"0")).join("")}catch(e){return uid()+uid()}}
async function hashPin(salt,pin,alg){
  const s=salt+":"+pin;
  const temSubtle=typeof crypto!=="undefined"&&crypto.subtle&&typeof crypto.subtle.digest==="function";
  if((!alg||alg==="s")&&temSubtle){
    const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
    return "s:"+Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
  }
  if(alg==="s")throw new Error("Este navegador não consegue verificar o PIN (abra o site por https).");
  return "c:"+cyrb(s);
}
const pinValido=p=>/^\d{4,8}$/.test(String(p||""));

/* ---------- tentativas e sessão ---------- */
const bloqueio=id=>{const t=LS.get("os_tent",{})[id];return t&&t.ate&&t.ate>Date.now()?Math.ceil((t.ate-Date.now())/1000):0};
function falha(id){const all=LS.get("os_tent",{});const t=all[id]||{n:0};t.n++;if(t.n>=5){t.ate=Date.now()+30000;t.n=0}all[id]=t;LS.set("os_tent",all)}
function tentOk(id){const all=LS.get("os_tent",{});delete all[id];LS.set("os_tent",all)}
async function login(id,pin){
  const u=users().find(x=>x.id===id);
  if(!u||!u.ativo)return{ok:false,erro:"Usuário inativo ou inexistente."};
  const b=bloqueio(id);if(b)return{ok:false,erro:"Muitas tentativas. Aguarde "+b+"s."};
  let h;
  try{h=await hashPin(u.salt,String(pin),String(u.hash).slice(0,1))}catch(e){return{ok:false,erro:e.message}}
  if(h!==u.hash){falha(id);return{ok:false,erro:"PIN incorreto."}}
  tentOk(id);
  LS.set("os_sess",{id,exp:Date.now()+8*3600*1000});
  return{ok:true};
}
const logout=()=>LS.del("os_sess");
function usuario(){
  const s=LS.get("os_sess",null);
  if(!s||!s.id||s.exp<Date.now())return null;
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
  nome=String(nome||"").trim();
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

/* ---------- fotos (IndexedDB) ---------- */
let db=null;
const dbReady=new Promise(r=>{try{const q=indexedDB.open("os_fotos",1);q.onupgradeneeded=()=>q.result.createObjectStore("f");q.onsuccess=()=>{db=q.result;r()};q.onerror=()=>r()}catch(e){r()}});
const fotoPut=async(id,b)=>{await dbReady;if(!db)return;return new Promise(r=>{try{const t=db.transaction("f","readwrite");t.objectStore("f").put(b,id);t.oncomplete=r;t.onerror=r}catch(e){r()}})};
const fotoGet=async id=>{await dbReady;if(!db)return null;return new Promise(r=>{try{const q=db.transaction("f").objectStore("f").get(id);q.onsuccess=()=>r(q.result||null);q.onerror=()=>r(null)}catch(e){r(null)}})};
const fotoDel=async id=>{await dbReady;if(!db)return;try{db.transaction("f","readwrite").objectStore("f").delete(id)}catch(e){}};

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
  criarUsuario,definirPin,fotoPut,fotoGet,fotoDel,aplicarTema,temaAtual,alternarTema,iniciarTema};
})();
