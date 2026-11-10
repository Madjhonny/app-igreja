# Expo SDK 58

Antes de alterar código Expo ou React Native, consulte a documentação correspondente ao SDK usado pelo projeto:

https://docs.expo.dev/versions/v58.0.0/

- Instale dependências com `npm ci`.
- Não fixe URLs de API nas telas; use `EXPO_PUBLIC_API_URL` e os helpers de `services/session.ts`.
- Nunca coloque segredos em variáveis `EXPO_PUBLIC_*`.
- Antes de concluir uma mudança, execute `npm run lint`, `npx tsc --noEmit` e a exportação web do Expo.
