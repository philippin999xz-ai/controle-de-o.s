import {alternarTema} from "../store.js";
const ICONE={sinc:["⏳","Sincronizando…"],ok:["☁️","Sincronizado com a nuvem"],erro:["⚠️","Falha ao sincronizar (veja Ajustes)"]};
export default function Cab({nuvem}){
  const ic=ICONE[nuvem?.s];
  return <header><img alt="Açoforja" src="logo.png"/><div className="t">Gestão Inteligente de OS</div>
    {ic&&<span className="nuvem" title={ic[1]} aria-label={ic[1]}>{ic[0]}</span>}
    <button className="tema" aria-label="Alternar tema claro/escuro" onClick={alternarTema}>🌓</button></header>;
}
