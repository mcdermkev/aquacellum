# Showcase Media Worker (Azure Container Apps)

This is the durable Sharp/libvips processor for the R1 Room-hero media slice. It polls the PostgreSQL job ledger through service-role-only RPCs; no queue message contains media bytes or object keys outside the database.

## Runtime

- Node 22
- Sharp 0.35.2 (pinned; packaged libvips)
- one always-on Azure Container App replica for the pilot
- secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- no public ingress

## Build and local checks

```powershell
npm ci
npm run check
docker build -t aquacellum-showcase-media-worker:local .
docker run --rm --memory 2g --cpus 1 aquacellum-showcase-media-worker:local npm run corpus
```

The corpus command runs the production decode/derive path in isolated child processes. It covers
valid JPEG/PNG/WebP inputs at the frozen pixel/dimension boundaries plus metadata stripping, SVG,
animation, malformed/truncated containers, CRC/length failures, trailing polyglots, and over-limit
sources. It prints per-case elapsed time and peak RSS and fails above a 1536 MiB peak-RSS ceiling,
leaving at least 512 MiB headroom in the documented 2 GiB Container App shape.

Do not run the worker against production for a smoke test unless migration `20260830160000_showcase_media_pipeline.sql` is applied and the two private buckets have been catalog-verified.

## Azure pilot shape

Use Azure Container Registry plus a Container App with external ingress disabled, 1 min / 1 max replica, 0.5–1 vCPU, and at least 1 GiB memory. The process is a bounded polling worker, so scale-to-zero is intentionally disabled for the first pilot. Configure secrets through Container Apps secret references, never image build arguments or plain environment values.

A representative deployment sequence (replace placeholders; do not paste secrets into shell history in a shared environment):

```powershell
az acr build --registry <registry> --image showcase-media-worker:<revision> .
az containerapp create --name showcase-media-worker --resource-group <rg> --environment <aca-env> --image <registry>.azurecr.io/showcase-media-worker:<revision> --ingress disabled --min-replicas 1 --max-replicas 1 --cpu 1 --memory 2Gi
```

Then add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as Container Apps secrets and secret references using your normal secret-management workflow.

## Required production evidence

Before setting Vercel `SHOWCASE_MEDIA_ENABLED=true`, record:

1. migration and private bucket/policy catalog probe;
2. Azure subscription/resource group, region, app revision, image digest, CPU/memory;
3. successful native Sharp startup on the deployed image;
4. processing time and peak RSS for valid JPEG/PNG/WebP fixtures at the frozen size/dimension limits;
5. deterministic rejection of SVG, animation, malformed/trailing/polyglot, over-pixel, and over-dimension fixtures;
6. output metadata inspection and both 4 MiB ceilings;
7. lease recovery, 5m/1h/6h/24h retries, deletion verification, and an alert destination for `media_jobs_overdue`;
8. online/offline publish→revoke proof showing no route or Cache Storage stale bytes.

The worker emits closed JSON events and job UUIDs only. It must never log source bytes, object keys, Supabase secrets, owner IDs, alt text, or upstream error messages.
