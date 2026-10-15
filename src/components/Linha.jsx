import {useState,useEffect} from "react";
import {obterFoto} from "../sync.js";
export default function Linha({r,onEdit,onDel}){
  const [url,setUrl]=useState("");
  useEffect(()=>{let u="",vivo=true;if(r.foto)obterFoto(r.id).then(b=>{if(b&&vivo){u=URL.createObjectURL(b);setUrl(u)}});return()=>{vivo=false;if(u)URL.revokeObjectURL(u)}},[r.id,r.foto]);
  return <div className="row"><b>OS {r.numero_os||"—"}</b> <span className="mut">{r.equipamento}</span>
    <div>{r.servico_solicitado}</div><div className="mut">{[r.executante,r.tipo_manutencao].filter(Boolean).join(" · ")}</div>
    {url&&<img className="prev" src={url} alt="Foto da OS"/>}
    <div className="acoes"><button className="sec" onClick={()=>onEdit(r)}>Editar</button><button className="del" onClick={()=>onDel(r)}>Excluir</button></div></div>;
}
