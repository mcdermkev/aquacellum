[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$expectedSubscription = "807d20ff-4100-4b9f-8665-b15199694a30"
$resourceGroup = "Aquacellum"
$environmentName = "aquacellum-media-env"
$appName = "showcase-media-worker"
$registryServer = "aquacellummedia.azurecr.io"
$imageDigest = "sha256:df659719820bba630c3c34fcfdee256fd9571deb5a286b93e265dbf3844967e9"
$image = "$registryServer/showcase-media-worker@$imageDigest"
$identityName = "aquacellum-media-pull"
$projectRef = "yahsdztnvsykzecjatsl"
$armApiVersion = "2024-03-01"
$armBaseUri = "https://management.azure.com"
$resourceGroupId = "/subscriptions/$expectedSubscription/resourceGroups/$resourceGroup"
$environmentId = "$resourceGroupId/providers/Microsoft.App/managedEnvironments/$environmentName"
$identityId = "$resourceGroupId/providers/Microsoft.ManagedIdentity/userAssignedIdentities/$identityName"
$appId = "$resourceGroupId/providers/Microsoft.App/containerApps/$appName"

try {
    $subscription = (& az account show --subscription $expectedSubscription --query id --output tsv).Trim()
    if ($LASTEXITCODE -ne 0 -or $subscription -ne $expectedSubscription) {
        throw "Refusing deployment: the approved Azure subscription is unavailable."
    }

    $armToken = (& az account get-access-token `
        --subscription $expectedSubscription `
        --resource "https://management.azure.com/" `
        --query accessToken `
        --output tsv).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($armToken)) {
        throw "Unable to obtain an Azure Resource Manager token for the approved subscription."
    }
    $armHeaders = @{ Authorization = "Bearer $armToken" }

    $appUri = "$armBaseUri$appId`?api-version=$armApiVersion"
    try {
        $null = Invoke-RestMethod -Method Get -Uri $appUri -Headers $armHeaders -ErrorAction Stop
        throw "Container App '$appName' already exists; refusing an implicit update."
    }
    catch {
        if ($_.Exception.Message -eq "Container App '$appName' already exists; refusing an implicit update.") {
            throw
        }
        $response = $_.Exception.Response
        $statusCode = if ($response -and $response.StatusCode) { [int]$response.StatusCode } else { $null }
        if ($statusCode -ne 404) {
            throw "Unable to establish that Container App '$appName' is absent; refusing deployment."
        }
    }

    try {
        $environment = Invoke-RestMethod -Method Get `
            -Uri "$armBaseUri$environmentId`?api-version=$armApiVersion" `
            -Headers $armHeaders -ErrorAction Stop
        $identity = Invoke-RestMethod -Method Get `
            -Uri "$armBaseUri$identityId`?api-version=2023-01-31" `
            -Headers $armHeaders -ErrorAction Stop
    }
    catch {
        throw "The approved Container Apps environment or managed pull identity is unavailable."
    }
    if ($environment.id -ine $environmentId -or $identity.id -ine $identityId) {
        throw "Azure dependency lookup returned an unexpected resource."
    }

    $supabaseUrl = "https://$projectRef.supabase.co"
    $keyResponseRaw = & supabase projects api-keys --project-ref $projectRef --output-format json
    if ($LASTEXITCODE -ne 0 -or -not $keyResponseRaw) {
        throw "Unable to obtain API keys for the approved Supabase project."
    }

    $keyResponse = $keyResponseRaw | ConvertFrom-Json
    $serviceKeys = @($keyResponse.keys | Where-Object { $_.name -eq "service_role" -and $_.type -eq "legacy" })
    if ($serviceKeys.Count -ne 1 -or [string]::IsNullOrWhiteSpace($serviceKeys[0].api_key)) {
        throw "The approved Supabase project did not return exactly one legacy service_role key."
    }
    $serviceKey = [string]$serviceKeys[0].api_key

    $jwtParts = $serviceKey.Split('.')
    if ($jwtParts.Count -ne 3) {
        throw "The Supabase service_role key is not a JWT."
    }
    $payloadPart = $jwtParts[1].Replace('-', '+').Replace('_', '/')
    switch ($payloadPart.Length % 4) {
        2 { $payloadPart += '==' }
        3 { $payloadPart += '=' }
    }
    $jwtPayloadText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadPart))
    $jwtPayload = $jwtPayloadText | ConvertFrom-Json
    if ($jwtPayload.role -ne "service_role" -or $jwtPayload.ref -ne $projectRef) {
        throw "The Supabase key claims do not match the approved project and service role."
    }

    $userAssignedIdentities = @{}
    $userAssignedIdentities[$identityId] = @{}
    $request = @{
        location = $environment.location
        identity = @{
            type = "UserAssigned"
            userAssignedIdentities = $userAssignedIdentities
        }
        properties = @{
            managedEnvironmentId = $environmentId
            configuration = @{
                activeRevisionsMode = "Single"
                registries = @(@{ server = $registryServer; identity = $identityId })
                secrets = @(
                    @{ name = "supabase-url"; value = $supabaseUrl }
                    @{ name = "supabase-service-key"; value = $serviceKey }
                )
            }
            template = @{
                revisionSuffix = "r1-20260903-1"
                containers = @(@{
                    name = $appName
                    image = $image
                    env = @(
                        @{ name = "SUPABASE_URL"; secretRef = "supabase-url" }
                        @{ name = "SUPABASE_SERVICE_KEY"; secretRef = "supabase-service-key" }
                    )
                    resources = @{ cpu = 1.0; memory = "2Gi" }
                })
                scale = @{ minReplicas = 1; maxReplicas = 1 }
            }
        }
    }
    $requestBody = $request | ConvertTo-Json -Depth 20 -Compress
    $createHeaders = @{
        Authorization = "Bearer $armToken"
        "Content-Type" = "application/json"
        "If-None-Match" = "*"
    }
    try {
        $created = Invoke-RestMethod -Method Put -Uri $appUri -Headers $createHeaders `
            -Body $requestBody -ErrorAction Stop
    }
    catch {
        $response = $_.Exception.Response
        $statusCode = if ($response -and $response.StatusCode) { [int]$response.StatusCode } else { "unknown" }
        throw "Container App create-only ARM request failed with HTTP status $statusCode."
    }

    [pscustomobject]@{
        name = $created.name
        location = $created.location
        provisioningState = $created.properties.provisioningState
        latestRevision = $created.properties.latestRevisionName
        ingress = $created.properties.configuration.ingress
        minReplicas = $created.properties.template.scale.minReplicas
        maxReplicas = $created.properties.template.scale.maxReplicas
    } | ConvertTo-Json -Depth 4
}
finally {
    # Best-effort reference cleanup; immutable PowerShell strings cannot be securely zeroized.
    $supabaseUrl = $null
    $serviceKey = $null
    $serviceKeys = $null
    $keyResponse = $null
    $keyResponseRaw = $null
    $jwtPayload = $null
    $jwtPayloadText = $null
    $payloadPart = $null
    $jwtParts = $null
    $request = $null
    $requestBody = $null
    $armToken = $null
    $armHeaders = $null
    $createHeaders = $null
}
