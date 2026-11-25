[CmdletBinding()]
param([switch]$SemAuditoria, [ValidateSet('14', '16', '17', '17.2')][string]$Etapa = '14')

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $raiz 'app-igreja'
$backend = Join-Path $raiz 'api-igreja'
$pastaEtapa = if ($Etapa -eq 17) { '17.1' } else { "$Etapa" }
$artefatos = Join-Path $frontend ("dist/artefatos-teste/$pastaEtapa/" + [Guid]::NewGuid().ToString('N'))
$web = Join-Path $artefatos 'web'
$expo = Join-Path $frontend 'node_modules/.bin/expo.cmd'
$tsc = Join-Path $frontend 'node_modules/.bin/tsc.cmd'
$eslint = Join-Path $frontend 'node_modules/.bin/eslint.cmd'
$variaveis = @{
    EXPO_NO_DOTENV = '1'
    EXPO_NO_TELEMETRY = '1'
    EXPO_PUBLIC_API_URL = 'http://localhost:3000'
    EXPO_PUBLIC_PUSH_ENABLED = 'false'
    AGENDA_E2E_PLATAFORMAS = $(if ($Etapa -ne '14') { '1' } else { '0' })
}
$anteriores = @{}

function Invoke-Etapa($Nome, $Diretorio, [scriptblock]$Acao) {
    Write-Host "`n=== $Nome ==="
    Push-Location -LiteralPath $Diretorio
    try {
        & $Acao
        if ($LASTEXITCODE -ne 0) { throw "$Nome falhou (codigo $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
}

try {
    foreach ($nome in $variaveis.Keys) {
        $anteriores[$nome] = [Environment]::GetEnvironmentVariable($nome, 'Process')
        [Environment]::SetEnvironmentVariable($nome, $variaveis[$nome], 'Process')
    }
    New-Item -ItemType Directory -Path $artefatos | Out-Null
    Write-Host "Artefatos em $artefatos"
    $antes = Invoke-Etapa 'Bancos locais' $backend { & node scripts/estado-bancos-teste.js }
    $antes | Set-Content -LiteralPath (Join-Path $artefatos 'bancos-antes.json') -Encoding UTF8
    try {
        Invoke-Etapa 'TypeScript' $frontend { & $tsc --noEmit }
        Invoke-Etapa 'ESLint' $frontend { & npm.cmd run lint }
        Invoke-Etapa 'ESLint dos testes web' $frontend {
            & $eslint --no-ignore --max-warnings 0 'tests/check-web-*.mjs'
        }
        Invoke-Etapa 'Frontend' $frontend { & npm.cmd run test:network }
        Invoke-Etapa 'PWA e dependencias' $frontend { & node --test tests/pwa.test.mjs tests/dependencies.test.cjs }
        Invoke-Etapa 'Sintaxe da API' $backend { & npm.cmd run check }
        Invoke-Etapa 'Backend, permissoes, PostgreSQL de interesses e push' $backend { & npm.cmd test }
        Invoke-Etapa 'Integridade das migrations' $backend { & node scripts/verificar-migrations-teste.js }
        Invoke-Etapa 'Exportacao web estatica' $frontend { & $expo export --platform web --output-dir $web }
        Invoke-Etapa 'Validacao da exportacao PWA' $frontend { & node tests/check-pwa-export.mjs $web }
        Invoke-Etapa 'Resiliencia web' $frontend {
            & node tests/check-web-resilience.mjs $web (Join-Path $artefatos 'resiliencia')
        }
        Invoke-Etapa 'E2E completo, incluindo responsividade, acessibilidade e hidratacao' $frontend {
            & node tests/check-web-e2e.mjs $web (Join-Path $artefatos 'e2e')
        }
        foreach ($plataforma in 'android', 'ios') {
            Invoke-Etapa "Bundle de desenvolvimento $plataforma" $frontend {
                & $expo export --dev --no-minify --no-bytecode --platform $plataforma --output-dir (Join-Path $artefatos $plataforma)
            }
        }
        Invoke-Etapa 'git diff --check' $raiz { & git diff --check main }
        if (!$SemAuditoria) {
            Invoke-Etapa 'Auditoria npm frontend' $frontend { & npm.cmd audit --json }
            Invoke-Etapa 'Auditoria npm backend' $backend { & npm.cmd audit --json }
        } else {
            Write-Host 'Auditorias npm devem ser executadas separadamente.'
        }
    } finally {
        $depois = Invoke-Etapa 'Limpeza dos schemas de teste' $backend { & node scripts/estado-bancos-teste.js }
        $depois | Set-Content -LiteralPath (Join-Path $artefatos 'bancos-depois.json') -Encoding UTF8
        if ($antes -cne $depois) { throw 'O estado dos bancos de teste mudou. Compare os dois arquivos de evidencias.' }
        Write-Host 'Estado dos bancos de teste conferido.'
    }
} finally {
    foreach ($nome in $anteriores.Keys) {
        [Environment]::SetEnvironmentVariable($nome, $anteriores[$nome], 'Process')
    }
}
