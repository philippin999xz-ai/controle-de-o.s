// Sincronização com a nuvem (Turso, via backend). Funciona em segundo plano; o app continua
// 100% utilizável sem internet: tudo é gravado aqui primeiro e enviado quando der.
import {req} from "./api.js";
import * as S from "./store.js";

let rodando=null,authFalhou=false;
export const configurado=()=>!!S.getToken();
export const resetarAuth=()=>{authFalhou=false};

class ErroSync extends Error{constructor(msg,auth=false){super(msg);this.auth=auth}}
async function chamar(path,opts,ms){
  const r=await req(path,opts,ms);
  if(r.ok)return r;
  const j=await r.json().catch(()=>({}));
  if(r.status===401)throw new ErroSync("Chave de acesso inválida.",true);
  if(r.status===429)throw new ErroSync(j?.error?.message||"Muitas tentativas. Aguarde.",true);
  if(r.status===503)throw new ErroSync("Nuvem não configurada no servidor.");
  throw new ErroSync((j?.error?.message||"Falha")+" [HTTP "+r.status+"]");
}

/** Envia o que mudou aqui e baixa o que mudou nos outros aparelhos. Nunca lança erro: devolve {ok,msg,mudou}. */
export function sincronizar(){
  if(!configurado())return Promise.resolve({ok:false,off:true});
  if(authFalhou)return Promise.resolve({ok:false,msg:"Chave de acesso inválida. Corrija em Ajustes."});
  if(rodando)return rodando;
  rodando=_sinc().catch(e=>{
    if(e.auth)authFalhou=true;                                  // não insiste com a chave errada
    return{ok:false,msg:e instanceof ErroSync?e.message:(e.name==="AbortError"?"Servidor demorou demais.":"Sem conexão com o servidor.")};
  }).finally(()=>{rodando=null});
  return rodando;
}

async function _sinc(){
  const desde=S.getDesde();
  if(desde==null){                                              // 1ª vez neste aparelho: tudo que existe aqui sobe
    for(const r of S.regs()){S.marcarPend(r.id);if(r.foto)S.marcarPendFoto(r.id)}
  }

  /* 1) ENVIA: OS alteradas + exclusões */
  const mapa=new Map(S.regs().map(r=>[r.id,r]));
  const idsPend=S.pend();
  S.limparPend(idsPend.filter(id=>!mapa.has(id)));              // já foi excluída aqui
  const itens=[
    ...idsPend.filter(id=>mapa.has(id)).map(id=>{const r=mapa.get(id);return{id,v:S.versao(r),dados:r}}),
    ...S.apagados().map(t=>({id:t.id,v:t.v,apagado:true})),
  ];
  for(let i=0;i<itens.length;i+=100){
    const lote=itens.slice(i,i+100);
    await chamar("/api/sync/os",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({itens:lote})},30000);
    S.limparPend(lote.filter(x=>!x.apagado).map(x=>x.id));
    S.limparApagados(lote.filter(x=>x.apagado).map(x=>x.id));
  }
  /* 2) ENVIA fotos novas */
  for(const id of S.pendFoto()){
    const blob=await S.fotoGet(id);
    if(!blob){S.limparPendFoto([id]);continue}
    await chamar("/api/sync/foto/"+encodeURIComponent(id),{method:"PUT",headers:{"Content-Type":blob.type||"image/jpeg"},body:blob},60000);
    S.limparPendFoto([id]);
  }

  /* 3) BAIXA o que mudou nos outros aparelhos (vence a versão mais recente) */
  const r=await chamar("/api/sync/os?desde="+(desde??0),{},30000);
  const {agora,itens:remotos}=await r.json();
  const local=new Map(S.regs().map(x=>[x.id,x]));
  const tomb=new Map(S.apagados().map(t=>[t.id,t.v]));
  let mudou=false;
  for(const it of remotos||[]){
    if(it.apagado){
      const l=local.get(it.id);
      if(l&&S.versao(l)<=it.v){local.delete(it.id);S.fotoDel(it.id);mudou=true}
    }else{
      const reg=S.limpaReg(it.dados);if(!reg)continue;
      const l=local.get(reg.id);
      if(tomb.has(reg.id)&&tomb.get(reg.id)>=S.versao(reg))continue;   // apaguei aqui depois dessa versão
      if(!l||S.versao(l)<S.versao(reg)){local.set(reg.id,reg);mudou=true}
    }
  }
  if(mudou)S.saveRegs([...local.values()].sort((a,b)=>(b.criado||"").localeCompare(a.criado||"")));
  S.setDesde(Math.max(0,Number(agora)-5000));                    // 5 s de folga: reprocessar é inofensivo
  return{ok:true,mudou};
}

/** Foto da OS: do aparelho; se não tiver (veio de outro aparelho), baixa da nuvem e guarda. */
export async function obterFoto(id){
  const b=await S.fotoGet(id);
  if(b||!configurado()||authFalhou)return b;
  try{
    const r=await req("/api/sync/foto/"+encodeURIComponent(id),{},20000);
    if(!r.ok)return null;
    const blob=await r.blob();
    S.fotoPut(id,blob).catch(()=>{});
    return blob;
  }catch{return null}
}
