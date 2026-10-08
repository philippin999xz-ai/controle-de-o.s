export const CAMPOS=[["numero_os","Número da Ordem"],["equipamento","Equipamento"],["servico_solicitado","Serviço solicitado"],["executante","Executante"],["tipo_manutencao","Tipo de manutenção"],["observacoes","Observação"]];
export const LONG=["servico_solicitado","observacoes"];
export const KEYS=CAMPOS.map(c=>c[0]);
export function limparNumeroOS(v){
  return String(v||"").trim().replace(/^(n[º°o]?\.?|n\.?º|os|o\.s\.?|ordem)\s*[:#\-–]?\s*/i,"").trim();
}


export const PROMPT_OS=`Você é um especialista em leitura de Ordens de Serviço (O.S.) da AÇOFORJA, emitidas pelo sistema Engeman, em manutenção industrial. A imagem é uma FOTO de celular de uma O.S., geralmente com letra manuscrita. Leia a imagem diretamente e preencha os campos.

SOBRE AS FOTOS:
- Podem aparecer VÁRIAS folhas empilhadas ou sobrepostas, além de mesa, mãos, canetas, fita e adesivos coloridos (bolinhas vermelhas, azuis, amarelas). Leia SOMENTE a folha da frente (a mais inteira, completa e em primeiro plano). Ignore as folhas de trás, mesmo que apareça texto delas. Adesivos são só marcações, não são texto.
- Existem dois modelos de folha:
  MODELO A (formulário preenchido à mão): quadros "Nº ORDEM DE SERVIÇO", "TAG EQUIPAMENTO", "TIPO DE MANUTENÇÃO" (ex.: CORRETIVA), "SETOR EXECUTANTE", "APROPRIAÇÃO DE HORAS" com coluna "Executante", "PROBLEMA DETECTADO", "SERVIÇO REALIZADO", "CAUSA RAIZ", "REQUER AÇÃO POSTERIOR" e "MANUTENTOR RESPONSÁVEL PELA LIBERAÇÃO".
  MODELO B (impressão do Engeman): "Ordem de Serviço", "Data Programada", "Equipamento", "Setor Executante", "Tipo de Manutenção" (ex.: MA-CO - MANUTENÇÃO CORRETIVA), "Serviço Solicitado", "Observações" e tabela "Executante".

PASSO 1 — "transcricao":
Transcreva fielmente o texto da folha da frente, linha a linha, na ordem em que aparece (rótulos impressos e texto manuscrito). Escreva [ilegível] onde não der para ler. Faça isso ANTES de preencher os campos.

PASSO 2 — campos:
- numero_os: número do quadro "Nº ORDEM DE SERVIÇO" (modelo A) ou "Ordem de Serviço" (modelo B). Costuma ter 6 dígitos e começar com 89 (ex.: 892366). Devolva só o número. NÃO confunda com data (ex.: 14/09/26), horário, "Data Programada", "Emitido em" ou código do equipamento. Se algum dígito manuscrito for duvidoso (1/7, 4/9, 6/0, 2/3), faça a melhor leitura e inclua o campo em "incertos".
- equipamento: TAG do equipamento. Modelo A: quadro "TAG EQUIPAMENTO", normalmente manuscrito (ex.: M60, PR-14, MCN01). Modelo B: campo "Equipamento" (código + descrição, ex.: PROESP/U - PROCESSOS ESPECIAIS/USINAGEM). Em letras ambíguas (O/0, I/1) faça a melhor leitura e marque em "incertos".
- servico_solicitado: modelo A: texto do quadro "PROBLEMA DETECTADO". Modelo B: texto do campo "Serviço Solicitado".
- executante: modelo A: nomes manuscritos na coluna "Executante" da tabela "APROPRIAÇÃO DE HORAS" (vários nomes separados por vírgula); se a coluna estiver vazia, use o nome de "MANUTENTOR RESPONSÁVEL PELA LIBERAÇÃO". Modelo B: nomes da tabela "Executante"; se estiver vazia, "". NÃO use o nome do Solicitante/Funcionário.
- tipo_manutencao: uma palavra padronizada: Corretiva, Preventiva, Preditiva ou Melhoria (ex.: "MA-CO - MANUTENÇÃO CORRETIVA" vira "Corretiva"). Se estiver tapado ou ilegível, "".
- observacoes: modelo A: junte em linhas separadas "Serviço realizado: ...", "Causa raiz: ..." e "Ação posterior: ..." (só as que estiverem preenchidas). Modelo B: texto do campo "Observações". Se vazio, "".

REGRAS:
1. Use somente o que está na imagem. Não invente, não complete e não suponha.
2. Campo ausente ou ilegível = "" e inclua o nome do campo em "incertos".
3. Na letra manuscrita, faça a melhor leitura e marque em "incertos" o campo em que tiver dúvida real.
4. Preserve números, códigos, nomes e acentuação como estão escritos (corrija apenas erros óbvios de leitura). Não traduza.
5. Não crie campos novos.`;

export const SCHEMA_OS={
  type:"object",
  properties:{
    transcricao:{type:"string",description:"Transcrição fiel de todo o texto visível na foto, linha a linha."},
    numero_os:{type:"string",description:"Número ou código da ordem, exatamente como impresso/escrito."},
    equipamento:{type:"string",description:"Equipamento ou máquina, com código/TAG se houver."},
    servico_solicitado:{type:"string",description:"Descrição completa do serviço solicitado."},
    executante:{type:"string",description:"Executante ou responsável pelo serviço."},
    tipo_manutencao:{type:"string",description:"Tipo de manutenção; somente a opção marcada, se houver caixas de seleção."},
    observacoes:{type:"string",description:"Observações adicionais da folha."},
    incertos:{type:"array",description:"Campos vazios, ilegíveis ou com leitura duvidosa.",items:{type:"string",enum:KEYS}}
  },
  required:["transcricao",...KEYS,"incertos"]
};

