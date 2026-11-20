# Agenda ADP — instalação web (PWA)

A PWA reutiliza o aplicativo Expo Web. Não requer uma nova build Android,
alterações na API, migrações de banco ou credenciais adicionais.

## Instalação

- iPhone/iPad: abra o endereço oficial no Safari, toque em Compartilhar e
  selecione **Adicionar à Tela de Início**.
- Android: abra o endereço oficial no Chrome, abra o menu e selecione
  **Instalar app** (ou **Adicionar à tela inicial**).
- Windows/macOS: no Chrome ou Edge, use a opção de instalação na barra de
  endereço ou no menu do navegador.

As opções variam conforme o navegador e a versão do sistema. Abra o ícone
Agenda ADP criado pelo sistema para usar o app em modo independente.

## Segurança e atualização

- O manifesto, ícones e service worker são publicados junto com o export web.
- O service worker não guarda páginas, respostas da API, sessão ou imagens.
  As navegações são feitas pela rede; se ela falhar, é exibida uma mensagem
  genérica de conexão indisponível.
- Consultar agenda, mural e perfil ainda requer internet. O modo offline de
  dados e as notificações web são melhorias separadas.
- Novas versões são recebidas pela web, sem reinstalar. Reabra o aplicativo
  para carregar a versão mais recente.
- O APK existente continua funcionando de forma independente.

## Validação

```sh
cd app-igreja
npm ci
node --test tests/pwa.test.mjs
npm run lint
npx tsc --noEmit
npx expo export --platform web
node tests/check-pwa-export.mjs dist
```

Na prévia HTTPS, confira a instalação em um navegador Chromium e no Safari
do iPhone. Verifique que o ícone e nome correspondem à marca, login e mural
funcionam, a tela offline aparece quando uma navegação falha e o app volta
a funcionar após reconectar.
