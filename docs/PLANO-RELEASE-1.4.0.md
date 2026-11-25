# Publicação e rollback do Agenda ADP 1.4.0

Este roteiro acompanha a preparação da release. Os comandos operacionais exigem autorização para a respectiva etapa. Execute no PowerShell. Os nomes `$shaRelease`, `$renderId`, `$deployWeb`, `$deployWebAnterior`, `$api`, `$web`, `$dump` e `$apk` representam valores que o responsável deve conferir e registrar antes do uso. Credenciais ficam no gerenciador de segredos usado pela operação, fora do repositório e dos logs.

A publicação e a geração do APK estão reservadas para **9 de dezembro de 2026 ou depois**, com a franquia EAS confirmada e nova autorização do responsável.

A sequência é **backup e migração → backend → web/PWA → APK**. A migração acrescenta `mural_interesses`, com chave composta, vínculos com usuário e publicação e cascata na exclusão. O comparativo com a 1.3.1 aponta os três endpoints de interesse como novas rotas. A API nova conserva as rotas anteriores e os testes exercitam sessões, permissões, publicação, comentários, curtidas e imagens legadas. Na etapa 17.1, o cliente web 1.3.1 foi testado com a API candidata em ambiente isolado. Repita o smoke com o SHA integrado antes de promover a web. O cliente 1.4.0 depende da API nova para interesses.

## Configuração a conferir antes da publicação

| Componente | Revisão da etapa 17.1 e verificação de publicação |
| --- | --- |
| Vercel | O projeto vinculado encontrado é `app-igreja-app-igreja`. A integração forneceu a versão Node `26.x`. Confira no painel o diretório `app-igreja`, o comando `npx expo export --platform web`, a saída `dist`, a versão Node aprovada, a branch de produção, os domínios servidos e o deploy anterior. A CI usa Node 22. Reproduza a exportação no runtime da Vercel ou alinhe o runtime somente com aprovação. |
| Render | O código valida `https://app-igreja-eks0.onrender.com` nos perfis EAS de produção. Confira no workspace correto o serviço, o SHA atual, o runtime, a raiz `api-igreja`, a instalação `npm ci`, a inicialização `npm start`, a rota `/health` e a política de auto-deploy. O conector nesta rodada não forneceu configuração do serviço sem a seleção de workspace. |
| Neon | O catálogo retornou `agenda-adp-homologacao` em PostgreSQL 17 e `agenda-igreja` em PostgreSQL 18, ambos com histórico de seis horas informado pelo conector. Confirme no Render a associação do banco e compute de produção antes de operar. Se o destino confirmado for PostgreSQL 18, use ferramentas de backup compatíveis e ensaie migração e restauração em PostgreSQL 18 isolado. A validação local desta etapa usou PostgreSQL 17. |
| CORS e sessão | Configure `CORS_ORIGINS` como origens HTTPS exatas separadas por vírgulas, sem caminhos ou barra final. Compare com todos os domínios web efetivamente servidos e mantenha `JWT_SECRET` estável para a transição. Origens de homologação e preview usam API isolada. Teste preflight com `Authorization` e com a origem canônica. Clientes nativos normalmente chegam sem `Origin`. |
| Variáveis web e nativas | `EXPO_PUBLIC_API_URL` é incorporada no export ou build. Confira o destino por ambiente, antes da geração. Qualquer variável `EXPO_PUBLIC_*` deve ser tratada como pública. `EXPO_PUBLIC_PUSH_ENABLED` deve ser decidido explicitamente como `true` ou `false`. O perfil `preview` exige `true` no hook existente e usa a API isolada. O build de produção utiliza o ambiente EAS `production` e a URL de produção definida no hook. |
| Firebase e push | Com push Android habilitado, configure `GOOGLE_SERVICES_JSON` como variável de arquivo do EAS. O hook valida o projeto Firebase `agenda-adp` e o pacote `br.com.agendaadp.app`. A chave de conta de serviço FCM v1 para Expo pertence ao gerenciador de credenciais do EAS. Confira `PUSH_NOTIFICATIONS_ENABLED` e `EXPO_PUSH_ACCESS_TOKEN` no Render sem exibir valores. Preserve o estado operacional aprovado da 1.3.1 durante a transição. Uma ativação nova ou envio real requer autorização específica e verificação em build nativa. Para futura distribuição iOS, confirme também APNs. |
| PWA | `vercel.json` configura `cleanUrls` e revalidação de `sw.js`, `pwa-register.js` e `manifest.json`. O Service Worker busca navegações pela rede e devolve aviso genérico na falta de conexão. HTML privado e API não entram no Cache Storage. Verifique atualização e retorno ao deploy anterior com um perfil já controlado pelo Service Worker. |
| Segredos do backend | Valide apenas presença, escopo e destino de `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT` e `DB_SSL`. Use TLS com verificação do certificado. Preserve o estado aprovado das configurações de e-mail, Cloudinary e push. A janela de publicação deve ter acesso ao backup, ao monitoramento e aos IDs de rollback. |

Referências dos provedores. [Vercel e domínios de produção](https://vercel.com/docs/deployments/promoting-a-deployment) · [Deploys do Render](https://render.com/docs/deploys) · [Neon Instant Restore](https://neon.com/docs/postgres/backup-restore/branch-restore) · [Compatibilidade do pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) · [Variáveis EAS](https://docs.expo.dev/eas/environment-variables/) · [Credenciais Android FCM v1](https://docs.expo.dev/push-notifications/fcm-credentials/).

## 17.1 — Preparação técnica

**Dependências.** Node e npm locais, Playwright com navegadores disponíveis, PostgreSQL isolado e variáveis `*_TEST_DATABASE_URL`. Use as instruções da [homologação](HOMOLOGACAO-1.4.0.md).

```powershell
git status --short --branch
git diff --check 8a17fd3
.\scripts\validar-homologacao.ps1 -Etapa 17
```

**Aprovação.** Validação local sem falhas, documentação e evidências preservadas, comparação com `8a17fd3` e pendências operacionais explicitadas. **Rollback.** Se uma alteração desta etapa falhar, reverta somente essa alteração preservando o trabalho local anterior. Nenhuma infraestrutura foi publicada nesta etapa.

## 17.2 — Versionamento e consolidação dos commits

**Dependências.** Autorização para commits locais e inventário conferido. Use a branch `feat/redesign-ui-1.4.0` e mantenha os 12 commits que já estavam na candidata.

```powershell
git branch --show-current
git diff --check 8a17fd3
git ls-files --others --exclude-standard
git diff -- app-igreja/app.json app-igreja/package.json app-igreja/package-lock.json
.\scripts\validar-homologacao.ps1 -Etapa 17.2
# Após ajustar o versionamento e revisar a lista de arquivos:
git add -- $arquivosDaRelease
git diff --cached --check
git diff --cached --name-status
git commit -m 'release: Agenda ADP 1.4.0'
git log --oneline 8a17fd3..HEAD
```

**Aprovação.** A versão pública do Expo, o pacote e o lockfile do frontend devem indicar `1.4.0`. O pacote privado da API conserva sua numeração independente. O `versionCode` é gerenciado remotamente pelo EAS. Repita a validação com o conjunto exato que será publicado. Os commits devem conter apenas fontes, testes, configurações e documentos da release. **Rollback.** Antes do commit, interrompa e mantenha os arquivos locais. Depois do commit, faça a correção em novo commit e preserve o histórico.

## 17.3 — Integração com a main

**Dependências.** Etapa 17.2 aprovada, autorização para enviar e integrar a branch, política de merge confirmada e plano de rollback com os IDs dos deploys vigentes. Antes do primeiro push, confirme quais integrações, hooks e workflows são acionados pela branch e se os previews usam API e dados isolados. Antes do merge, confirme Render com Auto-Deploy em `Off` e Vercel sem promoção automática dos domínios de produção. Se a configuração da Vercel permitir uma build antecipada, ela deve ficar sem tráfego de produção. Se o controle de tráfego ficar incerto, adie a operação correspondente.

```powershell
git fetch origin main
git push -u origin feat/redesign-ui-1.4.0
gh pr create --base main --head feat/redesign-ui-1.4.0 --title 'Agenda ADP 1.4.0' --body-file $descricaoPr
gh pr checks $pr --watch
gh pr merge $pr --merge
git fetch origin main
git rev-parse origin/main
```

**Aprovação.** Integre com CI verde e preservação dos commits da branch. Se a proteção da `main` bloquear o merge commit, confirme a política com o responsável antes de prosseguir. Registre o SHA integrado e confirme que `main` ainda não mudou os serviços que recebem tráfego. **Rollback.** Antes do merge, suspenda o PR. Depois do merge, prepare um PR de reversão. Se um deploy tiver recebido tráfego, execute o rollback do provedor e verifique os gatilhos antes da reversão no Git. [Merge pelo GitHub CLI](https://cli.github.com/manual/gh_pr_merge) · [Promoção controlada na Vercel](https://vercel.com/docs/deployments/promoting-a-deployment) · [Auto-Deploy do Render](https://render.com/docs/deploys).

## 17.4 — Backup, migrações e backend

**Dependências.** SHA integrado, janela autorizada, ponto de restauração confirmado no Neon, cliente PostgreSQL compatível e acesso ao Render. Faça primeiro o ensaio em banco isolado com a mesma versão principal. Em produção, compare `schema_migrations` com a base e confirme que o arquivo novo esperado é `20261124_mural_interesses.sql`. Se houver migração legada inesperadamente pendente, interrompa e investigue a divergência. O executor aplica cada arquivo em uma transação, com trava consultiva e histórico pelo nome do arquivo.

1. Confirme projeto, branch, host direto, nome do banco, versão do servidor e identidade de conexão. Registre horário UTC e janela do Instant Restore. Use configuração protegida da libpq, com TLS verificado e credencial fora da linha de comando. Guarde o dump fora do repositório em armazenamento de acesso restrito e criptografado.
2. Faça o backup e valide o sumário e o SHA-256. Ensaie a restauração em destino vazio, isolado e compatível, com aprovação para o acesso a eventuais dados pessoais. Valide schema, histórico, restrições e contagens agregadas. Retorne a sessão para o destino correto e confirme-o antes da próxima ação.
3. Configure apenas no processo de migração as variáveis `DB_*` da conexão direta confirmada. Aplique a migração pelo checkout do SHA liberado e confirme histórico, chave composta, vínculos e índice. A migração usa limites locais de 10 s para travas e 2 min para comandos. Em caso de erro ou divergência, mantenha o backend anterior e investigue antes de nova tentativa.
4. Publique o SHA exato no Render. Confirme `/health`, os logs e os contratos usados pela 1.3.1 antes de liberar a web. Verifique que o serviço não publicou outro SHA por automação.

```powershell
psql -X -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_setting(''server_version'');'
psql -X -v ON_ERROR_STOP=1 -c 'SELECT filename FROM schema_migrations ORDER BY filename;'
pg_dump --format=custom --no-owner --no-acl --file=$dump
pg_restore --list $dump
Get-FileHash -Algorithm SHA256 -LiteralPath $dump
# Sessão separada, conexão confirmada com o destino vazio e isolado:
pg_restore --exit-on-error --no-owner --no-acl -d $bancoRestauracao $dump
# De volta à sessão dedicada à migração, com o destino primário reconfirmado:
npm.cmd --prefix api-igreja run db:migrate
psql -X -v ON_ERROR_STOP=1 -c '\d mural_interesses'
psql -X -v ON_ERROR_STOP=1 -c 'SELECT filename FROM schema_migrations ORDER BY filename;'
render deploys create $renderId --commit $shaRelease --wait
curl.exe -fsS "$api/health"
```

**Aprovação.** Backup validado e restaurável, histórico e estrutura esperados, API saudável e compatibilidade 1.3.1 confirmada. **Rollback.** Se houver erro funcional de backend após promover a web, volte primeiro a web para a 1.3.1 e em seguida o backend para o deploy anterior do Render. Preserve `mural_interesses` e seus registros em rollback de aplicativo. Em incidente de dados, suspenda escritas de forma coordenada e restaure para um destino separado a fim de verificar o ponto e reconciliar registros gravados depois do backup. Trocar a conexão do serviço ou restaurar a branch primária exige decisão específica. [CLI do Render](https://render.com/docs/cli-reference) · [Rollback no Render](https://render.com/docs/rollbacks) · [Backup e recuperação no Neon](https://neon.com/docs/postgres/backup-restore/branch-restore).

## 17.5 — Web e PWA

**Dependências.** Backend saudável, CORS e variáveis Production conferidos, ID web anterior identificado e deploy candidato gerado no SHA da release. Use o deploy staged criado pelo Git quando corresponder ao SHA e ao ambiente. Se for necessário criar um pelo CLI, use um checkout limpo do mesmo SHA, ligado ao projeto correto, e confirme que o comando não atribui os domínios de produção.

```powershell
# A partir da raiz configurada no projeto e já vinculada à Vercel:
vercel deploy --prod --skip-domain
vercel inspect $deployWeb
vercel promote $deployWeb
curl.exe -fsSI "$web/sw.js"
curl.exe -fsSI "$web/pwa-register.js"
curl.exe -fsSI "$web/manifest.json"
```

**Aprovação.** Inicialmente confira a candidata sem troca do domínio principal. Compare rotas diretas, assets, cabeçalhos de revalidação, sessão e implantação do Service Worker. Os testes que escrevem dados usam o ambiente isolado, salvo plano separado aprovado para smoke em produção. Depois de promover, teste uma sessão recém-aberta e um perfil já controlado pela PWA após recarregar. **Rollback.** Execute `vercel rollback $deployWebAnterior`, confirme o alias e recarregue com o Service Worker em controle. Preserve a sessão e a tabela. A revalidação do script permite que os clientes ativos recebam o worker do deploy restaurado. Confira a política de promoção automática antes de reativá-la. [CLI da Vercel](https://vercel.com/docs/cli/deploy) · [Instant Rollback](https://vercel.com/docs/instant-rollback).

## 17.6 — APK Android 1.4.0

**Dependências.** Web estável, autorização específica e franquia EAS disponível. A renovação informada é **9 de dezembro de 2026**, sujeita à confirmação no painel. Confirme o projeto EAS, `production-apk`, a versão pública, o `versionCode` remoto, o ambiente `production`, a chave de assinatura compatível com o APK anterior e as variáveis descritas acima. Confirme a escolha da flag de push e o destino do Firebase antes de gastar a franquia.

```powershell
Push-Location app-igreja
eas build --platform android --profile production-apk --non-interactive
Pop-Location
apksigner verify --print-certs $apk
apkanalyzer manifest application-id $apk
apkanalyzer manifest version-name $apk
apkanalyzer manifest version-code $apk
Get-FileHash -Algorithm SHA256 -LiteralPath $apk
```

**Aprovação.** APK assinado, nome 1.4.0, pacote correto, `versionCode` maior que o instalado e hash registrado. Retenha a distribuição até a validação da etapa 17.7. **Rollback.** Suspenda novas instalações e mantenha compatibilidade de API para APKs já atualizados. Para substituir um APK instalado com erro, prepare um APK corretivo com a mesma assinatura e `versionCode` superior, mediante autorização. A desinstalação para downgrade pode perder dados locais. [APK com EAS](https://docs.expo.dev/build-reference/apk/) · [Versionamento remoto](https://docs.expo.dev/build-reference/app-versions/).

## 17.7 — Smoke em produção e validação do APK

**Dependências.** URLs, IDs e SHA confirmados, APK verificado e aparelhos autorizados. Contas ou ações de escrita em produção exigem escopo previamente aprovado. Faça primeiro as verificações públicas e sem escrita. Coordene prevenção de e-mail e push reais nas verificações que possam dispará-los.

```powershell
curl.exe -fsS "$api/health"
curl.exe -fsSI "$web/"
curl.exe -fsSI "$web/explore"
curl.exe -fsSi -X OPTIONS "$api/mural/interesses" -H "Origin: $web" -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'
adb install -r $apk
```

**Aprovação.** Confira saúde, CORS, rotas, logs, hidratação, sessão, compatibilidade 1.3.1 e uso 1.4.0. Valide em Android instalação limpa e atualização sobre o APK oficial que os usuários efetivamente têm instalado. Registre a versão de origem e confira sessão de teste, calendário, Eventos e interesses. Push remoto tem validação separada com um dispositivo autorizado. Registre aparelho e resultados efetivos. **Rollback.** Suspenda a distribuição diante de falha crítica. Volte a web e o backend na ordem da etapa 17.4 quando afetados. Mantenha o schema aditivo. Se um cliente 1.4.0 permanecer em uso durante rollback da API, a função de interesses ficará temporariamente indisponível.

## 17.8 — Encerramento da release

**Dependências.** Smoke aprovado, janela de observação concluída, aprovação para marcar e publicar a release. Arquive o SHA, IDs dos deploys, horário e checksum do backup, migrações, resultado de cada smoke e assinatura e SHA-256 do APK aprovado. Publique as notas e só distribua o APK validado.

```powershell
git tag -a v1.4.0 $shaRelease -m 'Agenda ADP 1.4.0'
git push origin refs/tags/v1.4.0
gh release create v1.4.0 --verify-tag --title 'Agenda ADP 1.4.0' --notes-file docs/RELEASE-1.4.0.md
```

**Aprovação.** A tag referencia o SHA publicado e os registros identificam as versões realmente servidas. **Rollback.** Diante de incidente, restaure o tráfego e detenha a distribuição conforme as etapas anteriores. Corrija a comunicação pública e use versão corretiva se necessário, mantendo o histórico da release.
