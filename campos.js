export const CAMPOS=[["numero_os","Número da Ordem"],["equipamento","Equipamento"],["servico_solicitado","Serviço solicitado"],["executante","Executante"],["tipo_manutencao","Tipo de manutenção"],["observacoes","Observação"]];
export const LONG=["servico_solicitado","observacoes"];
export const KEYS=CAMPOS.map(c=>c[0]);
export function limparNumeroOS(v){
  return String(v||"").trim().replace(/^(n[º°o]?\.?|n\.?º|os|o\.s\.?|ordem)\s*[:#\-–]?\s*/i,"").trim();
}
