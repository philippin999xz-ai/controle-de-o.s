import {Component} from "react";
// Se algo quebrar na interface, mostra uma mensagem em vez de tela branca.
export default class ErrorBoundary extends Component{
  state={erro:null};
  static getDerivedStateFromError(erro){return{erro}}
  componentDidCatch(erro,info){console.error("[ui]",erro,info?.componentStack)}
  render(){
    if(!this.state.erro)return this.props.children;
    return <main><div className="card"><b>⚠️ Algo deu errado</b>
      <p className="mut">O aplicativo encontrou um erro inesperado. Seus dados salvos neste aparelho não foram apagados.</p>
      <button onClick={()=>location.reload()}>Recarregar</button>
      <details><summary>Detalhe técnico</summary><pre>{String(this.state.erro?.stack||this.state.erro)}</pre></details></div></main>;
  }
}
