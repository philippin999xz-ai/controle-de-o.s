export default function Aviso({srv,onRetry}){
  if(srv.s==="online")return null;
  if(srv.s==="offline")return <div className="banner bad">❌ Servidor não respondeu. Você ainda pode preencher à mão.<br/><button onClick={onRetry}>Tentar de novo</button></div>;
  return <div className="banner warn">⏳ Acordando o servidor no Render (pode levar até 1 minuto). Você já pode preencher à mão.</div>;
}
