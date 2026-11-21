# Teste de carga da API

Executado automaticamente no job API da CI, em PostgreSQL descartável e API HTTP local. Não utiliza Render, Neon, Expo, contas ou credenciais reais.

## Cenário

- 800 contas fictícias, 1.000 eventos, 100 publicações e 2.000 curtidas.
- 50 usuários virtuais, 4 rodadas de 4 consultas por usuário (800 requisições), com autenticação individual nas rotas privadas.
- 8 logins simultâneos com o custo bcrypt 12 utilizado na recuperação e alteração de senha.
- Aquecimento fora das métricas. Tempo medido inclui HTTP local, processamento da API, consultas PostgreSQL e leitura do JSON.

| Rota | Requisições | Limite p95 |
| --- | ---: | ---: |
| GET /congregacoes | 200 | 3 s |
| GET /publico/eventos | 200 | 3 s |
| GET /eventos | 200 | 3 s |
| GET /mural | 200 | 3 s |
| POST /login | 8 | 10 s |

Qualquer resposta inesperada ou erro de transporte reprova a CI. Os logs exibem p50, p95, máximo e vazão das consultas, sem dados pessoais ou credenciais. Os limites são guardrails conservadores para o runner compartilhado, não uma promessa de latência aos usuários.

## Repetição e interpretação

O workflow `.github/workflows/ci.yml` inicia o PostgreSQL 17 e roda `npm test` na API. Localmente, o mesmo teste utiliza `PUSH_TEST_DATABASE_URL` apontando exclusivamente para um banco descartável chamado `agenda_push_test` em localhost; sem essa variável, os testes de integração são ignorados. Use uma instância nova a cada execução.

Este cenário representa um pico de 50 usuários ativos em uma base com 800 contas. Não mede 800 conexões simultâneas, nem capacidade dos planos de hospedagem, latência de internet, cold start, CDN ou transferência de imagens. A avaliação de capacidade da infraestrutura hospedada requer uma homologação planejada separadamente, nunca uma carga não autorizada em produção.
