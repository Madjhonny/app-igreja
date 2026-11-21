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

## Limites

Esta etapa monitora a API; não captura falhas nativas ou indisponibilidade total do servidor. A coleta de erros no cliente e alertas externos deve ser implementada separadamente, com política de privacidade e coleta minimizada. Nenhum serviço pago ou SDK novo é necessário para esta etapa.
