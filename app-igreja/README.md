# App Agenda ADP

Cliente Expo SDK 58 para Android, iOS e web. Usa Expo Router, React Native, TypeScript estrito e uma API HTTP configurável por ambiente.

## Instalação

```bash
npm ci
cp .env.example .env
```

Configure a API:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3000
```

Em dispositivo físico, `localhost` aponta para o próprio aparelho. Use um endereço acessível na rede ou uma API HTTPS. Não coloque segredos em variáveis `EXPO_PUBLIC_*`.

## Execução

```bash
npm start          # abre o servidor de desenvolvimento Expo
npm run android    # Android
npm run ios        # iOS
npm run web        # navegador
```

## Organização

- `app/`: rotas e telas do Expo Router.
- `components/`: componentes compartilhados e monitor global de sessão.
- `hooks/`: hooks de tema e sessão.
- `services/session.ts`: URL da API, requisições autenticadas e sincronização da sessão.
- `constants/`: tema visual.
- `assets/`: ícones e imagens do aplicativo.

## Sessão e permissões

O usuário precisa autenticar-se para acessar as áreas internas. O app pode adaptar a interface ao papel atual, mas toda autorização é confirmada novamente pela API.

Quando a API retorna sessão expirada, bloqueada ou revogada, o monitor global limpa apenas a sessão correspondente e direciona o usuário ao login. Novas chamadas devem usar os helpers de `services/session.ts`; não repita URLs da API nas telas.

## Mídia

Publicações aceitam somente os formatos suportados e validados pela API. URIs locais (`file://`) nunca devem ser persistidas como mídia compartilhável. Para adicionar vídeos no futuro, use upload para armazenamento de objetos e persista apenas uma URL HTTPS validada.

## Qualidade

Antes de abrir um pull request:

```bash
npm run lint
npx tsc --noEmit
EXPO_NO_TELEMETRY=1 npx expo export --platform web --output-dir /tmp/agenda-adp-web
```

Novos fluxos devem incluir estados de carregamento, erro e tentativa novamente, além de rótulos de acessibilidade em controles somente por ícone.

## Build com EAS

```bash
npx eas build --profile development --platform android
npx eas build --profile preview --platform android
npx eas build --profile production --platform all
```

Os identificadores nativos estão em `app.json`; perfis de build e submissão ficam em `eas.json`. Consulte sempre a [documentação do Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/) ao alterar APIs nativas.
