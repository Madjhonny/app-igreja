# Homologação local do Agenda ADP 1.4.0

Execute a partir da raiz do repositório no PowerShell. Use Node.js 22 atualizado ou 24, npm, Git, PostgreSQL 17 local e o Chromium do Playwright. A porta `3000` deve estar livre para a API E2E.

## Preparação

```powershell
npm.cmd ci --prefix api-igreja
npm.cmd ci --prefix app-igreja
Push-Location app-igreja
npx.cmd playwright install chromium
Pop-Location
```

Os três bancos precisam existir no PostgreSQL local. Use uma conta de teste com permissão de conexão e de criação de schemas. Configure as URLs no ambiente do processo. O exemplo abaixo recebe cada URL completa com a entrada ocultada. Use `postgresql://`, `localhost` ou `127.0.0.1`, e codifique caracteres reservados do usuário e da senha. As URLs devem ter apenas o nome do banco no caminho.

```powershell
$bancos = [ordered]@{
    INTERESSES_TEST_DATABASE_URL = 'agenda_interesses_test'
    WEB_TEST_DATABASE_URL = 'agenda_web_test'
    PUSH_TEST_DATABASE_URL = 'agenda_push_test'
}
foreach ($entrada in $bancos.GetEnumerator()) {
    $urlProtegida = Read-Host "URL local de $($entrada.Value)" -AsSecureString
    [Environment]::SetEnvironmentVariable(
        $entrada.Key, [Net.NetworkCredential]::new('', $urlProtegida).Password, 'Process'
    )
    $urlProtegida.Dispose()
}
```

## Execução

```powershell
.\scripts\validar-homologacao.ps1
```

O roteiro executa tipagem, lint, testes do frontend e da API, integrações de interesses e push, migrações, exportação web estática, PWA, resiliência, E2E e bundles JavaScript de desenvolvimento para Android e iOS. A auditoria npm consulta o registro configurado. Em um ambiente com acesso ao registro separado da execução local, rode os dois comandos de auditoria e execute o roteiro com `-SemAuditoria`.

Para repetir a rodada da release, deixe Chrome e Edge instalados e inclua Firefox e WebKit do Playwright. O roteiro da etapa 17 usa diretório próprio e inclui os cenários adicionais de navegadores e PWA.

```powershell
Push-Location app-igreja
npx.cmd playwright install firefox webkit
Pop-Location
.\scripts\validar-homologacao.ps1 -Etapa 17
```

Para repetir a validação da candidata já versionada, use `-Etapa 17.2`. Execute também `npx.cmd --yes expo-doctor --verbose` em `app-igreja`, com `EXPO_NO_DOTENV=1`, para validar a configuração e as dependências do SDK.

```powershell
npm.cmd audit --json --prefix app-igreja
npm.cmd audit --json --prefix api-igreja
.\scripts\validar-homologacao.ps1 -SemAuditoria
```

O cenário de fila de push usa respostas simuladas do Expo. A integração HTTP desativa o push e simula o serviço de e-mail. As integrações de interesses, push, migrations e web criam schemas temporários e removem os schemas da execução ao sair. O roteiro registra o estado antes e depois, incluindo as contagens das tabelas de fixtures antigas encontradas no `public` do banco de push. Se houver uma interrupção forçada, examine os schemas remanescentes antes de decidir sobre a remoção.

As capturas, diagnósticos e bundles ficam em `app-igreja/dist/artefatos-teste/<etapa>/<id>`. A etapa padrão usa `14`. A preparação técnica usa `17.1` e a candidata versionada usa `17.2`. Cada execução usa um diretório novo. O diagnóstico de JavaScript e hidratação fica nos subdiretórios `e2e` e `resiliencia`. O entrypoint histórico `check-web-e2e.mjs` usa a suíte completa, que inclui os cinco cenários E2E originais.

## Reexecução de verificações específicas

```powershell
Push-Location api-igreja
node --test tests/push-postgres.test.js
node --test tests/mural-interesses-postgres.test.js tests/mural-interesses-http.test.js
node scripts/verificar-migrations-teste.js
Pop-Location
```

O teste de migrações usa o executor da API para aplicar os arquivos em ordem em um schema local novo e verificar que a segunda execução preserva o histórico. A homologação em aparelhos físicos, incluindo leitores de tela e notificações reais, é uma etapa manual. Os bundles desta etapa são exportações JavaScript locais. Nenhum fluxo do roteiro utiliza EAS ou serviços de produção.
