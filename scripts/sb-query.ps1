# Run read-only SQL against the linked Supabase project via the Management API.
# Reuses the Supabase CLI's stored access token from Windows Credential Manager
# so no new secret is introduced. The token is never printed.
#
# Usage: pwsh -NoProfile -File scripts/sb-query.ps1 -Sql "select 1"
param(
    [string]$Sql,
    [string]$SqlFile,
    [string]$ProjectRef = "yahsdztnvsykzecjatsl"
)

if ($SqlFile) { $Sql = Get-Content -Raw -LiteralPath $SqlFile }
if (-not $Sql) { Write-Error "Provide -Sql or -SqlFile"; exit 1 }

$signature = @'
using System;
using System.Runtime.InteropServices;
public class CredMan {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll")]
    public static extern void CredFree(IntPtr buffer);

    // The CLI stores the token as raw UTF-8 bytes, not UTF-16, so decode the
    // blob explicitly rather than using PtrToStringUni.
    public static string Read(string target) {
        IntPtr credPtr;
        if (!CredRead(target, 1, 0, out credPtr)) {
            throw new Exception("CredRead failed for '" + target + "' (error " + Marshal.GetLastWin32Error() + ")");
        }
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            byte[] blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, (int)cred.CredentialBlobSize);
            return System.Text.Encoding.UTF8.GetString(blob).Trim().Trim('\0');
        } finally {
            CredFree(credPtr);
        }
    }
}
'@

if (-not ("CredMan" -as [type])) { Add-Type -TypeDefinition $signature -Language CSharp }

$token = [CredMan]::Read("Supabase CLI:supabase")
if (-not $token) { Write-Error "Empty access token"; exit 1 }

$uri = "https://api.supabase.com/v1/projects/$ProjectRef/database/query"
$body = @{ query = $Sql } | ConvertTo-Json -Compress

try {
    $resp = Invoke-RestMethod -Uri $uri -Method POST `
        -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
        -Body $body -ErrorAction Stop
    $resp | ConvertTo-Json -Depth 8
} catch {
    $r = $_.Exception.Response
    if ($r) {
        $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
        Write-Host "HTTP $([int]$r.StatusCode): $($sr.ReadToEnd())"
    } else {
        Write-Host "Request failed: $($_.Exception.Message)"
    }
    exit 1
}
