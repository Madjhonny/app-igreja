# Agenda ADP

Aplicativo multiplataforma para agenda, comunicação e gestão de uma igreja. O projeto combina um app Expo/React Native com uma API Node.js/Express e PostgreSQL.

## Estrutura

```text
.
├── app-igreja/                 # App Expo (Android, iOS e web)
├── api-igreja/                 # API Express e testes
│   ├── migrations/             # Schema versionado do PostgreSQL
│   └── scripts/                # Utilitários operacionais, incluindo migrations
└── .github/workflows/ci.yml    # Validação automatizada
```

## Requisitos

- Node.js 22 LTS ou superior compatível com o Expo SDK 58
- npm 10 ou superior
- PostgreSQL 15 ou superior
- Para desenvolvimento nativo: Android Studio, Xcode ou um dispositivo com build de desenvolvimento compatível

Use sempre `npm ci` para instalar exatamente as versões registradas nos lockfiles.

## Configuração rápida

### 1. API e banco

```bash
cd api-igreja
npm ci
cp .env.example .env
```

Crie um banco vazio, preencha as variáveis de `api-igreja/.env` e aplique o schema:

```bash
npm run db:migrate
npm test
npm start
```

A API fica em `http://localhost:3000` por padrão. Nunca versione o arquivo `.env`.

### 2. Aplicativo

Em outro terminal:

```bash
cd app-igreja
npm ci
cp .env.example .env
npm start
```

Defina `EXPO_PUBLIC_API_URL` com uma URL acessível pelo dispositivo:

- Web no mesmo computador: `http://localhost:3000`
- Emulador Android: normalmente `http://10.0.2.2:3000`
- Aparelho físico: use o IP da máquina na rede local ou uma API HTTPS publicada

Variáveis `EXPO_PUBLIC_*` são incorporadas ao bundle e não podem conter segredos.

## Papéis e permissões

- `MASTER`: gestão global, papéis, congregações e planejamento anual.
- `ADMIN`: gestão de eventos, publicações e membros da própria congregação, após aprovação.
- `MEMBRO`: leitura da agenda e interação no mural, após aprovação.
- `PENDENTE`: sessão limitada enquanto aguarda aprovação.

A API é a fonte de verdade das permissões. Ocultar um botão no app não substitui autorização no servidor.

## Validação local

```bash
# API
cd api-igreja
npm run check
npm test

# App
cd ../app-igreja
npm run lint
npx tsc --noEmit
EXPO_NO_TELEMETRY=1 npx expo export --platform web --output-dir /tmp/agenda-adp-web
```

O CI executa as mesmas verificações em cada push e pull request. Testes que dependam de PostgreSQL devem usar um banco descartável; nunca a base de produção.

## Banco e migrations

O schema inicial está em `api-igreja/migrations/001_initial_schema.sql`. Aplique migrations antes de iniciar uma nova versão da API:

```bash
cd api-igreja
npm run db:migrate
```

Migrations já publicadas não devem ser reescritas. Crie um novo arquivo numerado para cada alteração posterior e mantenha backup antes de mudanças de produção.

## Deploy

### API

1. Configure as variáveis descritas em `api-igreja/.env.example` no provedor.
2. Use PostgreSQL com TLS e validação de certificado.
3. Execute `npm run db:migrate` como etapa controlada de release.
4. Inicie com `npm start` e publique somente via HTTPS.
5. Restrinja `CORS_ORIGINS` às origens web realmente usadas.

### Aplicativo

1. Aponte `EXPO_PUBLIC_API_URL` para a API HTTPS de produção.
2. Valide lint, TypeScript e exportação web.
3. Gere builds pelos perfis definidos em `app-igreja/eas.json`, por exemplo:

```bash
cd app-igreja
npx eas build --profile preview --platform android
npx eas build --profile production --platform all
```

Revise certificados, identificadores das lojas e políticas de privacidade antes da submissão.

## Segurança operacional

- Use um `JWT_SECRET` longo, aleatório e exclusivo por ambiente.
- Mantenha credenciais apenas no gerenciador de segredos do provedor.
- Não desative a validação TLS do PostgreSQL.
- Aplique rate limiting também na borda/reverse proxy.
- Monitore respostas `401`, `403`, `429` e `5xx` sem registrar tokens, senhas, CPF ou telefone.
- Faça backup e teste restauração do banco periodicamente.
- Avalie alertas do `npm audit` no contexto do runtime; não use `npm audit fix --force` sem testes de regressão.

Detalhes específicos estão em [`api-igreja/README.md`](api-igreja/README.md) e [`app-igreja/README.md`](app-igreja/README.md).
