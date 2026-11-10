# API Igreja

API Express/PostgreSQL usada pelo aplicativo Expo. Requer Node.js 20 ou superior e PostgreSQL 15 ou superior.

## Configuração local

1. Copie `.env.example` para `.env` e preencha uma chave JWT longa e as credenciais do banco.
2. Instale de forma reproduzível com `npm ci`.
3. Crie o schema com `npm run db:migrate`.
4. Cadastre as congregações necessárias na tabela `congregacoes`.
5. Inicie com `npm start`.

As migrations são aplicadas em ordem, sob lock consultivo, e registradas em `schema_migrations`. Faça backup e teste a migration antes de aplicá-la a um banco antigo com dados que possam violar as novas constraints.

## Segurança e ambiente

- `CORS_ORIGINS` é obrigatório para clientes web e aceita uma lista separada por vírgula. Clientes nativos não enviam `Origin`.
- Em produção, mantenha `DB_SSL=true`. Certificados públicos usam a trust store do sistema; para uma CA privada, informe `DB_SSL_CA`.
- Fotos aceitas: JPEG, PNG ou WebP por HTTPS ou data URI, até `MAX_IMAGE_BYTES`.
- Login e cadastro possuem limites por IP configuráveis pelas variáveis do `.env.example`.

## Verificação

```bash
npm run check
npm test
npm audit --omit=dev
```

Os testes atuais isolam regras de autenticação/autorização. A suíte ainda deve ser complementada por integração HTTP contra um PostgreSQL descartável.
