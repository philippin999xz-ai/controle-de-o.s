# IA com alternativas para demonstrações

O backend tenta as opções configuradas, em ordem, e para na primeira resposta válida. Ao receber cota esgotada (429), falha de rede, indisponibilidade, chave recusada ou resposta inválida, tenta a próxima opção compatível. O navegador não precisa de chaves. Usuários, O.S., fotos e histórico continuam no Turso.

**O código não cria contas nem gera créditos.** Cada alternativa exige a chave de sua própria conta no Render. Planos gratuitos, modelos, disponibilidade e requisitos podem mudar. Usar cinco chaves não garante cinco serviços disponíveis nem soma cotas de uma mesma conta. Não habilite faturamento ou recarga automática para esta configuração de demonstração. As contas Google/Hugging Face devem estar no plano gratuito, sem cobrança adicional; o backend não consegue consultar ou limitar a cobrança dessas contas. O OpenRouter é restringido a modelos gratuitos e preço zero por token.

## Comece com duas alternativas

1. Mantenha a `GROQ_API_KEY` atual.
2. Crie uma chave em [Google AI Studio](https://aistudio.google.com/apikey), em um projeto habilitado para a faixa gratuita sem faturamento, e adicione `GEMINI_API_KEY` no Render.
3. Crie uma chave em [OpenRouter](https://openrouter.ai/settings/keys), mantenha a conta sem recarga e adicione `OPENROUTER_API_KEY` no Render. O modelo padrão é `openrouter/free`; ele escolhe um modelo gratuito compatível com a requisição. Pode não haver um modelo de visão gratuito disponível naquele momento.
4. Para usar OpenRouter, Cerebras ou Hugging Face na solução de problemas, crie também uma chave gratuita de busca no [Tavily](https://app.tavily.com/) e adicione `TAVILY_API_KEY`. Sem essa chave, essas opções **não** fazem diagnóstico com alegação de pesquisa web. Groq e Gemini usam sua pesquisa nativa e não dependem do Tavily.
5. Faça o deploy e abra **Administração → Conexões e dados → Verificar conexão**. A tela mostra quais provedores estão configurados e para quais funções. “Configurado” não significa que a chave ou a cota já foi validada por uma chamada real.

Nunca cole chaves no front-end, no GitHub, em arquivos versionados ou em mensagens. Não precisa instalar plugin.

## Até cinco provedores de modelos

| Ordem | Provedor | Variáveis no Render | Imagem de O.S. | Pesquisa de falhas |
|---|---|---|---|---|
| 1 | [Groq](https://console.groq.com/keys) | `GROQ_API_KEY` | Sim, modelo com visão | Busca nativa `browser_search` |
| 2 | [Gemini](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` | Sim | Busca Google, se disponível na cota/modelo da conta |
| 3 | [OpenRouter](https://openrouter.ai/settings/keys) | `OPENROUTER_API_KEY` | Se houver modelo gratuito com visão | Exige `TAVILY_API_KEY` |
| 4 | [Cerebras](https://cloud.cerebras.ai/) | `CEREBRAS_API_KEY` + `CEREBRAS_MODEL` | Não | Exige `TAVILY_API_KEY` |
| 5 | [Hugging Face](https://huggingface.co/settings/tokens) | `HF_TOKEN` + `HF_MODEL` e/ou `HF_VISION_MODEL` | Exige `HF_VISION_MODEL` compatível | Exige `HF_MODEL` + `TAVILY_API_KEY` |

Cerebras e Hugging Face ficam desativados até que você informe um ID de modelo disponível no catálogo e no plano gratuito da sua conta. O token Hugging Face precisa permitir chamadas a Inference Providers; cotas/créditos gratuitos podem ser pequenos. Não selecione um provedor com cobrança adicional. Os modelos de texto não recebem fotos: o roteamento respeita as capacidades de cada opção.

## Ajustes opcionais

- `GROQ_MODELS`: modelos de visão, separados por vírgula; preserva o padrão anterior `qwen/qwen3.8-27b`.
- `DIAGNOSTICO_MODEL`: modelo Groq com `browser_search`; padrão `openai/gpt-oss-120b`.
- `GEMINI_VISION_MODEL` e `GEMINI_SEARCH_MODEL`: padrão `gemini-2.5-flash`; se o catálogo mudar, configure outro modelo compatível da faixa gratuita.
- `OPENROUTER_VISION_MODEL` e `OPENROUTER_SEARCH_MODEL`: padrão `openrouter/free`. Somente `openrouter/free` ou IDs terminados em `:free` são aceitos. A chamada também exige preço máximo zero por token; nenhuma ferramenta paga de busca do OpenRouter é habilitada.
- `AI_SEARCH_MAX_TOKENS`: padrão 2400, intervalo 800–4000. Reduzido em relação aos 6000 anteriores para economizar cota. Respostas cortadas ou sem fontes não são mostradas como orientação completa: o servidor tenta outra opção.

## Pausas e limites

- As tentativas compartilham um orçamento total de 65 segundos. Uma opção lenta pode consumir o tempo restante antes de todas as alternativas serem tentadas.
- Cota 429: respeita `Retry-After` quando informado (até 24 horas); sem ele, pausa de 60 segundos. Após a pausa, volta a tentar a opção principal automaticamente. Uma cota diária pode continuar esgotada: a pausa não a renova.
- Chave recusada/modelo ausente: pausa de 15 minutos. Outros erros: 30 segundos. Com uma única opção e HTTP 500/502/503/504, há uma nova tentativa dentro do mesmo orçamento.
- As pausas ficam na memória de cada instância Render e reiniciam após um deploy/restart. Cotas do provedor continuam sendo compartilhadas pela conta/organização.
- Pesquisas via Tavily usam busca `basic`, até quatro resultados e reaproveitam a mesma evidência entre alternativas de texto dentro da requisição. Se o Tavily estiver sem cota, essas opções não conseguem pesquisar.
- Se nenhuma opção estiver disponível, a interface mostra o tempo para tentar novamente. Não há resposta simulada. Cadastro manual de O.S., fotos e consulta ao histórico continuam disponíveis com o banco conectado.
- Nem todos os modelos interpretam imagens ou pesquisam na web. Valide uma foto e uma falha no app antes de uma demonstração, sem consumir cotas com testes repetitivos.

## Verificação de código

`node --test backend/*.test.js` cobre troca por cota, chave, rede, resposta inválida, isolamento de chaves, preço zero do OpenRouter, pausa/retorno ao principal, pesquisa com fontes e persistência no histórico. Os provedores externos são simulados nesses testes. Isso não comprova que as chaves das contas reais funcionam ou que as cotas gratuitas estão disponíveis.
