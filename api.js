// Conexão com o backend no Render. O plano gratuito "dorme" e a 1ª resposta pode levar ~1 min:
// por isso o app "acorda" o servidor ao abrir e tenta de novo, em vez de falhar na primeira.
export const API_BASE=(import.meta.env.VITE_API_BASE||"https://controle-de-o-s.onrender.com").replace(/\/$/,"");
const MODELOS=["gemini-3.8-flash","gemini-3.5-flash"];
const espera=ms=>new Promise(r=>setTimeout(r,ms));
export class ErroApi extends Error{constructor(codigo,detalhe){super(detalhe||codigo);this.codigo=codigo;this.fatal=false}}

async function req(path,opts={},ms=90000){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),ms);
  try{return await fetch(API_BASE+path,{...opts,signal:ctl.signal,cache:"no-store"})}   // sem cookies: evita bloqueio de CORS
  finally{clearTimeout(t)}
}

export async function acordar(onStatus=()=>{}){
  const ini=Date.now();
  for(let i=0;i<12;i++){
    try{
      const r=await req("/api/health",{},12000);
      if(r.ok){const j=await r.json().catch(()=>({}));onStatus("online",{ai:!!j.ai});return{ok:true,ai:!!j.ai}}
      onStatus("acordando",{http:r.status});
    }catch(e){onStatus("acordando",{seg:Math.round((Date.now()-ini)/1000)})}
    await espera(4000);
  }
  onStatus("offline");return{ok:false,ai:false};
}

function textoResposta(j){
  if(typeof j?.output_text==="string"&&j.output_text.trim())return j.output_text;
  const out=[];
  for(const s of j?.steps||[])if(s.type==="model_output")for(const c of s.content||[])if(typeof c?.text==="string")out.push(c.text);
  return out.join("\n").trim();
}

export async function gem(input,schema){
  let ultimo=null;
  for(const model of MODELOS){
    for(let tent=0;tent<2;tent++){
      try{
        const body={model,input};
        if(schema)body.response_format={type:"text",mime_type:"application/json",schema};
        const r=await req("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
        const j=await r.json().catch(()=>({}));
        if(r.ok){const t=textoResposta(j);if(t)return t;throw new ErroApi("http","O servidor respondeu sem texto.")}
        if(r.status===503)throw Object.assign(new ErroApi("ia_off",j?.error?.message),{fatal:true});
        const e=new ErroApi("http",(j?.error?.message||"Falha")+" [HTTP "+r.status+" · "+model+"]");
        if([400,401,403].includes(r.status)){e.fatal=true;throw e}
        ultimo=e;
      }catch(e){
        if(e.fatal)throw e;
        ultimo=e instanceof ErroApi?e:new ErroApi(e.name==="AbortError"?"tempo":"rede",e.name==="AbortError"?"Tempo esgotado esperando o servidor.":"Sem conexão com o servidor ("+(e.message||"falha de rede")+").");
      }
      await espera(1500);
    }
  }
  throw ultimo||new ErroApi("rede");
}

// Estagiário (nível 1) vê só frases curtas; os demais veem o detalhe técnico.
export function erroAmigavel(e,simples){
  const s={rede:"Sem conexão com o servidor. Tente de novo.",tempo:"O servidor demorou. Tente de novo.",ia_off:"Leitura automática indisponível. Preencha à mão.",http:"Não consegui ler a foto. Tente outra foto ou preencha à mão."};
  return simples?(s[e?.codigo]||s.http):(e?.message||s.http);
}
