// URL base da sua API Python local
const API_BASE_URL = 'http://127.0.0.1:8000';

document.addEventListener('DOMContentLoaded', () => {
  const formOS = document.getElementById('formOS');
  const inputImagem = document.getElementById('inputImagem'); // ID do seu input type="file"

  // -------------------------------------------------------------
  // 1. ENVIO MANUAL DO FORMULÁRIO PARA O BANCO SQLITE LOCAL
  // -------------------------------------------------------------
  if (formOS) {
    formOS.addEventListener('submit', async (event) => {
      event.preventDefault();

      const dadosFormulario = {
        cliente: document.getElementById('cliente').value,
        descricao: document.getElementById('descricao').value,
        status: document.getElementById('status').value
      };

      try {
        const response = await fetch(`${API_BASE_URL}/api/os`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(dadosFormulario)
        });

        if (response.ok) {
          const resultado = await response.json();
          alert('Ordem de Serviço salva com sucesso no banco de dados!');
          formOS.reset();
        } else {
          alert('Erro ao salvar no banco de dados local.');
        }
      } catch (erro) {
        console.error('Erro ao conectar com a API local:', erro);
        alert('Não foi possível conectar à API local. O Python está rodando no terminal?');
      }
    });
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
