export async function carregarBitmap(file){
  if(window.createImageBitmap){
    try{return await createImageBitmap(file,{imageOrientation:"from-image"})}catch(e){}
  }
  return new Promise((res,rej)=>{const img=new Image(),u=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(u);res(img)};img.onerror=rej;img.src=u});
}
// 2000px / JPEG 0,9: mantém letra pequena legível para o Gemini
export async function reduzir(file,max=2000){
  const img=await carregarBitmap(file);
  const w0=img.width||img.naturalWidth,h0=img.height||img.naturalHeight;
  const k=Math.min(1,max/Math.max(w0,h0));
  const c=document.createElement("canvas");
  c.width=Math.round(w0*k);c.height=Math.round(h0*k);
  const g=c.getContext("2d");
  g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);
  g.drawImage(img,0,0,c.width,c.height);
  if(img.close)try{img.close()}catch(e){}
  return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error("falha ao gerar imagem")),"image/jpeg",.9));
}

export const b64=b=>new Promise((res,rej)=>{const f=new FileReader();f.onload=()=>res(String(f.result).split(",")[1]);f.onerror=rej;f.readAsDataURL(b)});