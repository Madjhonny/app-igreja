# Otimização da agenda

- A grade calcula um índice de dias marcados e conexões de intervalos usando uma passagem pelos eventos e uma pelos dias. Não consulta todos os eventos repetidamente para cada célula. Eventos de dias consecutivos só são conectados visualmente se compartilham um período, como antes.
- A troca de mês cancela a consulta anterior com AbortController. A resposta só altera o estado se ainda corresponder à consulta ativa. Resultados são associados ao mês consultado, evitando mostrar a lista anterior durante uma transição.
- O estado de mês/ano foi unificado em um índice, evitando inconsistências em cliques rápidos e viradas de ano. Nenhum dado de eventos é persistido em cache; a agenda continua consultando o servidor ao retornar à tela, inclusive após criação ou edição.
- Sem mudanças na API, banco, permissões, filtros, layout ou dependências.
- Testes automatizados verificam intervalos, ano bissexto, sobreposições em 2.000 eventos, cancelamento e isolamento por mês. O teste Playwright simula resposta atrasada e duas trocas consecutivas no navegador.
