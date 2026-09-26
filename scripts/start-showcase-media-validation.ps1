[CmdletBinding()]
param(
    [string]$ContainerName = "fish-dex-showcase-media-validation",
    [string]$Image = "postgres:16.4-alpine"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$mountRoot = $repoRoot -replace '\\', '/'
$label = "fish-dex.showcase-media.validation=true"
$password = "showcase-media-disposable-only"

$migrations = @(
    "supabase/migrations/20260829110000_showcase_identity_foundation.sql",
    "supabase/migrations/20260829120000_showcase_publication_foundation.sql",
    "supabase/migrations/20260829130000_showcase_rls_projection_rpc.sql",
    "supabase/migrations/20260829141000_showcase_r13_identity_api_foundation.sql",
    "supabase/migrations/20260829142000_showcase_r13_publication_api_rpc.sql",
    "supabase/migrations/20260829143000_showcase_r13_final_acl.sql",
    "supabase/migrations/20260830130000_showcase_r14_commerce_seam.sql",
    "supabase/migrations/20260830150000_showcase_commerce_photo.sql",
    "supabase/migrations/20260830160000_showcase_media_pipeline.sql"
)

function Invoke-DockerChecked {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$existing = (& docker ps -a --filter "name=^/$ContainerName$" --format "{{.ID}}")
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Docker containers" }
if ($existing) {
    throw "Container '$ContainerName' already exists. Inspect or remove it explicitly before retrying."
}

$started = $false
try {
    Invoke-DockerChecked @(
        "run", "--detach", "--name", $ContainerName,
        "--label", $label,
        "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m",
        "--mount", "type=bind,source=$mountRoot,target=/workspace,readonly",
        "--env", "POSTGRES_PASSWORD=$password",
        "--env", "POSTGRES_DB=showcase_media_validation",
        $Image
    )
    $started = $true

    $ready = $false
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        & docker exec $ContainerName psql --username postgres --dbname showcase_media_validation --tuples-only --command "SELECT 1" *> $null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "The target PostgreSQL database did not become queryable within 30 seconds" }

    $sqlFiles = @("scripts/showcase-media-validation-bootstrap.sql") + $migrations
    foreach ($relativePath in $sqlFiles) {
        Write-Host "Applying $relativePath"
        Invoke-DockerChecked @(
            "exec", $ContainerName,
            "psql", "--username", "postgres", "--dbname", "showcase_media_validation",
            "--set", "ON_ERROR_STOP=1", "--file", "/workspace/$relativePath"
        )
    }

    $imageId = (& docker inspect --format "{{.Image}}" $ContainerName).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect validation image" }
    Write-Host "Showcase-media migration replay complete."
    Write-Host "Container: $ContainerName"
    Write-Host "Image ID:  $imageId"
    Write-Host "The container remains running for catalog, concurrency, and failure probes."
}
catch {
    if ($started) {
        Write-Warning "Replay failed; removing only labeled disposable container '$ContainerName'."
        & docker rm --force $ContainerName *> $null
    }
    throw
}
