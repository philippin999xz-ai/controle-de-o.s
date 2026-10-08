// OCR local (Tesseract.js): implementação mantida como estava. NÃO está ligada à interface.
// Para reativar no futuro: importe ocrLocal e chame-o a partir de um botão.
import {KEYS,LONG,limparNumeroOS} from "./campos.js";
import {carregarBitmap} from "./imagem.js";
let setMsg=()=>{};
export const aoProgredirOCR=f=>{setMsg=f};
function carregarTesseract(){
  if(window.Tesseract)return Promise.resolve(window.Tesseract);
  return new Promise((ok,err)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";s.onload=()=>ok(window.Tesseract);s.onerror=()=>err(new Error("Tesseract indisponível"));document.head.appendChild(s)});
}
// Escala de cinza + esticamento de contraste (ajuda o Tesseract)
async function prepararParaOCR(blob){
  const img=await carregarBitmap(blob);
  const c=document.createElement("canvas");
  c.width=img.width||img.naturalWidth;c.height=img.height||img.naturalHeight;
  const g=c.getContext("2d",{willReadFrequently:true});
  g.drawImage(img,0,0);
  if(img.close)try{img.close()}catch(e){}
  const im=g.getImageData(0,0,c.width,c.height),d=im.data,hist=new Uint32Array(256);
  for(let i=0;i<d.length;i+=4){const y=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);d[i]=d[i+1]=d[i+2]=y;hist[y]++}
  const tot=c.width*c.height;let acc=0,lo=0,hi=255;
  for(let i=0;i<256;i++){acc+=hist[i];if(acc>=tot*.01){lo=i;break}}
  acc=0;for(let i=255;i>=0;i--){acc+=hist[i];if(acc>=tot*.01){hi=i;break}}
  const span=Math.max(1,hi-lo);
  for(let i=0;i<d.length;i+=4){const v=Math.max(0,Math.min(255,(d[i]-lo)*255/span));d[i]=d[i+1]=d[i+2]=v}
  g.putImageData(im,0,0);
  return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error("falha no preparo")),"image/png"));
}

// =====================================================================
//  OCR LOCAL (Tesseract) — usado só como reserva (sem chave ou se o Gemini falhar)
// =====================================================================
let ocrWorker=null;
async function obterOCRWorker(){
  if(ocrWorker)return ocrWorker;
  const Tesseract=await carregarTesseract();
  ocrWorker=await Tesseract.createWorker("por",1,{
    logger:m=>{if(m&&typeof m.progress==="number")setMsg("🔎 OCR local lendo a foto... "+Math.round(m.progress*100)+"%")}
  });
  try{await ocrWorker.setParameters({tessedit_pageseg_mode:"6",preserve_interword_spaces:"1"})}catch(e){}
  return ocrWorker;
}
function normalizarOCR(t){
  return (t||"").replace(/\r/g,"").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
}
async function ocrLocal(blob){
  const worker=await obterOCRWorker();
  let alvo=blob;
  try{alvo=await prepararParaOCR(blob)}catch(e){console.warn("sem pré-processamento",e)}
  const result=await worker.recognize(alvo);
  const texto=normalizarOCR(result?.data?.text||"");
  if(!texto)throw new Error("não foi encontrado texto legível na imagem");
  return texto;
}

// ---- extração por rótulos (reserva). Rótulos específicos, para não casar com o título do formulário ----
const semAcento=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const ROTULOS={
  numero_os:["no ordem de servico","n ordem de servico","ordem de servico","numero da ordem","n da ordem","no da ordem","numero da os","numero os","n os","ordem n","ordem no","o.s. n","os n","n da o.s"],
  equipamento:["tag equipamento","tag do equipamento","equipamento","maquina","tag"],
  servico_solicitado:["problema detectado","servico solicitado","descricao do servico","servico a executar","servico a ser executado","defeito apresentado","solicitacao"],
  executante:["executante","executado por","responsavel pela execucao","responsavel","mecanico","tecnico"],
  tipo_manutencao:["tipo de manutencao","tipo manutencao","tipo da manutencao","manutencao"],
  observacoes:["observacoes","observacao","obs.","servico realizado","causa raiz"]
};
function acharRotulo(linha){
  // troca º/° por "o" (mesmo tamanho) para os índices continuarem alinhados com a linha original
  const l=semAcento(linha).replace(/[°º]/g,"o");
  let melhor=null;
  for(const k of KEYS){
    for(const r of ROTULOS[k]){
      const i=l.indexOf(r);
      if(i<0||i>30)continue;
      // exige que o rótulo termine em fronteira de palavra
      const fim=i+r.length,prox=l[fim]||" ";
      if(/[a-z0-9]/.test(prox))continue;
      if(!melhor||r.length>melhor.len)melhor={k,len:r.length,fim};
    }
  }
  return melhor;
}
function extrairCamposOCR(texto){
  const t=normalizarOCR(texto);
  const linhas=t.split("\n").map(x=>x.trim()).filter(Boolean);
  const dados={};KEYS.forEach(k=>dados[k]="");
  const marcas=linhas.map(acharRotulo);
  for(let i=0;i<linhas.length;i++){
    const m=marcas[i];if(!m||(dados[m.k]&&m.k!=="observacoes"))continue;
    let resto=linhas[i].slice(m.fim).replace(/^[\s:;\-–—.#]+/,"").trim();
    const partes=resto?[resto]:[];
    const maxLinhas=LONG.includes(m.k)?6:(resto?0:1);
    for(let j=i+1;j<linhas.length&&partes.length<(resto?1+maxLinhas:maxLinhas);j++){
      if(marcas[j])break;
      partes.push(linhas[j]);
    }
    const txt=partes.join(" ").trim();
    if(m.k==="observacoes"){
      const rot=linhas[i].slice(0,m.fim).trim();
      const rl=rot.toLowerCase(),pref=/^obs/.test(semAcento(rl))?"":rl.charAt(0).toUpperCase()+rl.slice(1)+": ";
      if(txt)dados.observacoes=(dados.observacoes?dados.observacoes+"\n":"")+pref+txt;
    }else dados[m.k]=txt;
  }
  if(!dados.numero_os){
    const m=t.match(/(?:\bO\.?\s?S\.?|ORDEM(?:\s+DE\s+SERVI[ÇC]O)?)\s*(?:N[º°o.]*)?\s*[:#\-]?\s*([A-Z]{0,3}[-/]?\d{2,}[A-Z0-9\-/]*)/i);
    if(m)dados.numero_os=m[1];
  }
  dados.numero_os=limparNumeroOS(dados.numero_os);
  return {...dados,incertos:KEYS.filter(k=>!dados[k]),ocr_texto:t,origem:"ocr"};
}


export {ocrLocal,extrairCamposOCR,normalizarOCR};
