[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef
)

$ErrorActionPreference = "Stop"
$expectedProjectRef = "yahsdztnvsykzecjatsl"
if ($ProjectRef -ne $expectedProjectRef) {
    throw "Refusing deployment: expected Aquacellum project '$expectedProjectRef', received '$ProjectRef'."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$queryScript = Join-Path $PSScriptRoot "sb-query.ps1"
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

$forbidden = @(
    "supabase/migrations/20260830120000_morph_subspecies.sql",
    "supabase/migrations/20260830140000_marketplace_pickup_inquiries.sql"
)
if ($migrations | Where-Object { $forbidden -contains $_ }) {
    throw "Deployment list includes an explicitly excluded migration."
}

$preflightSql = @"
DO `$preflight`$
BEGIN
  IF to_regclass('public.showcase_owner_principals') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND left(p.proname, 9) = 'showcase_'
     )
     OR EXISTS (
       SELECT 1 FROM storage.buckets
       WHERE id IN ('showcase-media-source-v1', 'showcase-media-derivatives-v1')
     ) THEN
    RAISE EXCEPTION 'SHOWCASE_PRODUCTION_PREFLIGHT_NOT_EMPTY';
  END IF;
END;
`$preflight`$;
"@

Write-Host "Verifying empty showcase boundary on Aquacellum ($ProjectRef)..."
& pwsh -NoProfile -File $queryScript -ProjectRef $ProjectRef -Sql $preflightSql
if ($LASTEXITCODE -ne 0) { throw "Production preflight failed." }

foreach ($relativePath in $migrations) {
    $absolutePath = Join-Path $repoRoot $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
        throw "Missing reviewed migration: $relativePath"
    }
    Write-Host "Applying reviewed production migration: $relativePath"
    & pwsh -NoProfile -File $queryScript -ProjectRef $ProjectRef -SqlFile $absolutePath
    if ($LASTEXITCODE -ne 0) {
        throw "Production migration failed: $relativePath"
    }
}

Write-Host "Reviewed showcase-media production migration chain applied successfully."
Write-Host "Excluded and untouched: 20260830120000_morph_subspecies.sql"
Write-Host "Excluded as unrelated: 20260830140000_marketplace_pickup_inquiries.sql"
