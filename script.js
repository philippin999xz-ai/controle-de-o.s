// Substitua pela URL exata gerada no painel do seu Render
const API_URL = "https://controle-de-o-s.onrender.com";

async function enviarFotosParaOS() {
    const inputFiles = document.getElementById("inputFotos"); // Seu input tipo file
    const inputObs = document.getElementById("inputObservacao"); // Seu textarea/input de observações (se houver)
    const btnEnviar = document.getElementById("btnEnviar");
    const statusDiv = document.getElementById("statusMensagem");

    if (!inputFiles.files || inputFiles.files.length === 0) {
        alert("Por favor, selecione ou tire ao menos uma foto.");
        return;
    }

    // Feedback visual para o usuário
    if (btnEnviar) btnEnviar.disabled = true;
    if (statusDiv) statusDiv.innerHTML = "⏳ Processando foto com IA e atualizando a planilha...";

    const formData = new FormData();
    for (let i = 0; i < inputFiles.files.length; i++) {
        formData.append("files", inputFiles.files[i]);
    }
    if (inputObs) {
        formData.append("observacoes", inputObs.value);
    }

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            body: formData
        });

        const resultado = await response.json();

        if (response.ok && resultado.sucesso) {
            if (statusDiv) statusDiv.innerHTML = `✅ O.S. #${resultado.id_os} registrada com sucesso!`;
            
            // Preenche os campos da sua interface bonita com o retorno do Gemini
            if (document.getElementById("campoCliente")) document.getElementById("campoCliente").value = resultado.dados.cliente || "";
            if (document.getElementById("campoEquipamento")) document.getElementById("campoEquipamento").value = resultado.dados.equipamento || "";
            if (document.getElementById("campoDescricao")) document.getElementById("campoDescricao").value = resultado.dados.descricao || "";
            if (document.getElementById("campoTecnico")) document.getElementById("campoTecnico").value = resultado.dados.tecnico || "";
            
            alert(`O.S. #${resultado.id_os} registrada e salva na planilha!`);
        } else {
            if (statusDiv) statusDiv.innerHTML = "❌ Erro: " + (resultado.detail || "Falha ao processar");
        }
    } catch (error) {
        console.error("Erro na comunicação:", error);
        if (statusDiv) statusDiv.innerHTML = "❌ Falha ao conectar com o servidor Python.";
    } finally {
        if (btnEnviar) btnEnviar.disabled = false;
    }
}

  // -------------------------------------------------------------
  // 2. PROCESSAMENTO DE OCR / IMAGEM COM O GEMINI VIA PYTHON
  // -------------------------------------------------------------
  if (inputImagem) {
    inputImagem.addEventListener('change', async (event) => {
      const arquivo = event.target.files[0];
      if (!arquivo) return;

      try {
        console.log('Convertendo imagem para Base64...');
        const base64Image = await converterParaBase64(arquivo);

        console.log('Enviando para a API local processar o OCR via Gemini...');
        const dadosExtraidos = await lerComGeminiBackend(base64Image);

        if (dadosExtraidos) {
          // Preenche automaticamente os campos do formulário com o resultado do OCR
          if (dadosExtraidos.cliente) {
            document.getElementById('cliente').value = dadosExtraidos.cliente;
          }
          if (dadosExtraidos.descricao) {
            document.getElementById('descricao').value = dadosExtraidos.descricao;
          }
          if (dadosExtraidos.status) {
            document.getElementById('status').value = dadosExtraidos.status;
          }
          alert('Dados da imagem extraídos com sucesso!');
        }
      } catch (erro) {
        console.error('Erro no processamento da imagem:', erro);
        alert('Ocorreu um erro ao ler a imagem. Verifique o console.');
      }
    });
  }
});

// Função auxiliar para converter arquivo de imagem em String Base64
function converterParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

// Função que chama a rota /api/ocr do Python
async function lerComGeminiBackend(base64Image) {
  const response = await fetch(`${API_BASE_URL}/api/ocr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      imagem_base64: base64Image
    })
  });

  if (!response.ok) {
    const erroDetalhes = await response.json().catch(() => ({}));
    throw new Error(erroDetalhes.detail || 'Falha na resposta do servidor');
  }

  const resultado = await response.json();
  
  // O Python devolve a string JSON gerada pelo Gemini, nós fazemos o parse
  return typeof resultado.dados === 'string' ? JSON.parse(resultado.dados) : resultado.dados;
}
