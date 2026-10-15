// Tudo da leitura de O.S. fica NO SERVIDOR (Gemini): prompt, schema e limpeza do resultado.
// O front só envia a foto; ninguém consegue usar a sua chave para outra coisa.
export const KEYS = ["numero_os", "equipamento", "servico_solicitado", "executante", "tipo_manutencao", "observacoes"];
const TIPOS = ["Corretiva", "Preventiva", "Preditiva", "Melhoria"];

export const PROMPT_OS = `Você lê FOTOS de celular de Ordens de Serviço (O.S.) da AÇOFORJA (manutenção industrial, sistema Engeman), quase sempre com letra manuscrita. Preencha os campos lendo a imagem diretamente. Responda só o JSON pedido.

FOTO: pode ter várias folhas empilhadas, mesa, mãos, fita e adesivos coloridos. Leia SOMENTE a folha da frente (a mais inteira e em primeiro plano); ignore folhas de trás e adesivos.
Dois modelos de folha:
A) Formulário preenchido à mão: "Nº ORDEM DE SERVIÇO", "TAG EQUIPAMENTO", "TIPO DE MANUTENÇÃO", "SETOR EXECUTANTE", "APROPRIAÇÃO DE HORAS" (coluna "Executante"), "PROBLEMA DETECTADO", "SERVIÇO REALIZADO", "CAUSA RAIZ", "REQUER AÇÃO POSTERIOR", "MANUTENTOR RESPONSÁVEL PELA LIBERAÇÃO".
B) Impressão do Engeman: "Ordem de Serviço", "Data Programada", "Equipamento", "Setor Executante", "Tipo de Manutenção" (ex.: MA-CO - MANUTENÇÃO CORRETIVA), "Serviço Solicitado", "Observações", tabela "Executante".

CAMPOS:
- numero_os: só o número da ordem (6 dígitos, costuma começar com 89, ex.: 892366). NÃO é data, horário, "Data Programada", "Emitido em" nem código de equipamento.
- equipamento: A) quadro "TAG EQUIPAMENTO" (ex.: M60, PR-14, MCN01). B) campo "Equipamento" (código + descrição). Em letras ambíguas (O/0, I/1) escolha a leitura mais provável.
- servico_solicitado: A) "PROBLEMA DETECTADO". B) "Serviço Solicitado".
- executante: A) nomes manuscritos na coluna "Executante" de "APROPRIAÇÃO DE HORAS", separados por vírgula; se vazia, o "MANUTENTOR RESPONSÁVEL PELA LIBERAÇÃO". B) nomes da tabela "Executante"; se vazia, "". Nunca o Solicitante/Funcionário.
- tipo_manutencao: Corretiva, Preventiva, Preditiva ou Melhoria (ex.: "MA-CO - MANUTENÇÃO CORRETIVA" = Corretiva). Tapado/ilegível = "".
- observacoes: A) linhas "Serviço realizado: ...", "Causa raiz: ...", "Ação posterior: ..." (só as preenchidas). B) campo "Observações". Vazio = "".

REGRAS: use só o que está na imagem, sem inventar nem completar. Ausente ou ilegível = "" e liste o campo em "incertos". Em letra manuscrita faça a melhor leitura e liste em "incertos" só o campo com dúvida real (dígitos 1/7, 4/9, 6/0, 2/3 no número da O.S. contam). Preserve códigos, nomes e acentos; não traduza.`;

// Schema da resposta (JSON Schema aceito pelo Gemini). Sem "transcricao": era a maior fonte de token de saída.
export const SCHEMA_OS = {
  type: "object",
  properties: {
    numero_os: { type: "string", description: "Só o número da O.S. (6 dígitos, costuma começar com 89)." },
    equipamento: { type: "string", description: "TAG/código do equipamento, como escrito." },
    servico_solicitado: { type: "string", description: "Problema detectado / serviço solicitado." },
    executante: { type: "string", description: "Nomes dos executantes, separados por vírgula." },
    tipo_manutencao: { type: "string", description: "Corretiva, Preventiva, Preditiva ou Melhoria; vazio se ilegível." },
    observacoes: { type: "string", description: "Serviço realizado, causa raiz, ação posterior ou observações; vazio se não houver." },
    incertos: { type: "array", description: "Campos vazios ou com leitura duvidosa.", items: { type: "string", enum: KEYS } },
  },
  required: [...KEYS, "incertos"],
};

// Limpeza determinística (grátis, sem token): padroniza e marca para conferir o que parece estranho.
export function normalizarResultado(d) {
  const campos = {};
  for (const k of KEYS) campos[k] = String(d?.[k] ?? "").replace(/\s+\n/g, "\n").trim();

  campos.numero_os = campos.numero_os.replace(/^(n[º°o]?\.?|os|o\.s\.?|ordem)\s*[:#\-–]?\s*/i, "").trim();
  const so = campos.numero_os.replace(/\D/g, "");
  if (so && so.length >= 5 && so.length <= 8 && /^[\d\s.-]+$/.test(campos.numero_os)) campos.numero_os = so;

  const t = campos.tipo_manutencao.toLowerCase();
  campos.tipo_manutencao = TIPOS.find((x) => t.startsWith(x.toLowerCase().slice(0, 5))) || "";

  campos.executante = [...new Set(campos.executante.split(/\s*[,;/]\s*/).filter(Boolean))].join(", ");

  const incertos = new Set((Array.isArray(d?.incertos) ? d.incertos : []).filter((k) => KEYS.includes(k)));
  for (const k of KEYS) if (!campos[k] && k !== "observacoes") incertos.add(k); // observação vazia é normal
  if (campos.numero_os && !/^89\d{4}$/.test(campos.numero_os)) incertos.add("numero_os"); // formato fora do padrão: conferir
  return { campos, incertos: [...incertos] };
}
