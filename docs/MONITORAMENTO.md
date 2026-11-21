# Monitoramento da Agenda ADP

## API

O middleware de monitoramento registra `http_request` em JSON no stdout/stderr do Render, usando apenas método HTTP, rota parametrizada, status, duração em milissegundos e indicadores de lentidão/desconexão. Não inclui URL original, query, parâmetros, IP, conteúdo enviado, token ou identidade.

- `info`: pedidos concluídos, inclusive respostas esperadas de autenticação/validação.
- `warn`: duração a partir de 1 segundo, rate limit (429) ou conexão interrompida (499, apenas no log).
- `error`: resposta 5xx.

No Render, procure por `http_request` nos logs do serviço. Filtre por `slow`, `status` ou `route` para investigar. Os logs não são gravados no banco de dados.

## Saúde

`GET /health` retorna HTTP 200 com `{"status":"ok"}` quando a API consegue executar `SELECT 1` no PostgreSQL, ou 503 com `{"status":"unavailable"}` em caso de falha ou timeout. A resposta não contém detalhes do banco e usa `Cache-Control: no-store`. Uma verificação interna é compartilhada por chamadas simultâneas e reaproveitada por até cinco segundos para limitar a carga.

Após homologação e publicação, pode-se configurar `/health` como Health Check Path no Render e testar disponibilidade por um monitor externo. Não alterar o health check do serviço de produção antes da publicação desta rota.

## Aplicativo

`POST /telemetria` recebe apenas plataforma (`web`, `android`, `ios`, `other`) e contadores de falhas finais de rede, timeout, respostas 5xx e erros de renderização capturados pelo ErrorBoundary da raiz. Os registros `client_diagnostic` não contêm identificadores, mensagens, stack traces, credenciais ou URLs. A conexão HTTP utiliza endereço IP para transporte e limitação de abuso, sem incluí-lo nos registros de diagnóstico.

Os contadores ficam em memória, limitados a 100 por categoria. O envio ocorre após uma resposta bem-sucedida da API ou ao capturar um erro de renderização, no máximo uma vez por minuto, com timeout de cinco segundos e sem bloquear o usuário. O endpoint não exige login, limita o corpo a 1 KB e aceita até 60 requisições por IP a cada 15 minutos. Dados extras e categorias desconhecidas são rejeitados.

## Limites

O diagnóstico é de melhor esforço: pode perder eventos se o app fechar ou o envio falhar. Não captura falhas fatais nativas, todos os erros JavaScript ou indisponibilidade total permanente do servidor. Contadores não autenticados não devem ser considerados prova de incidentes. Alertas externos são uma etapa separada. Nenhum serviço pago ou SDK novo é necessário.
