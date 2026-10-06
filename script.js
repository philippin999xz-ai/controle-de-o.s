document.getElementById('formOS').addEventListener('submit', async function(event) {
  // Evita que a página recarregue ao enviar o formulário
  event.preventDefault();

  // 1. Captura os valores digitados nos campos
  const dadosFormulario = {
    cliente: document.getElementById('cliente').value,
    descricao: document.getElementById('descricao').value,
    status: document.getElementById('status').value
  };

  // 2. Envia os dados para a sua API Python local
  try {
    const response = await fetch('http://127.0.0.1:8000/api/os', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dadosFormulario)
    });

    if (response.ok) {
      const resultado = await response.json();
      alert('Ordem de Serviço enviada com sucesso!');
      
      // Limpa os campos do formulário
      document.getElementById('formOS').reset();
    } else {
      alert('Erro ao salvar no banco de dados local.');
    }
  } catch (erro) {
    console.error('Erro de conexão:', erro);
    alert('Não foi possível conectar à API local. O Python está rodando?');
  }
});
