# DeployDock - Setup Hosts File
# Run this script as Administrator to enable .internal domain routing
# Right-click PowerShell -> Run as Administrator -> then run this script
#
# Usage: powershell -ExecutionPolicy Bypass -File setup-hosts.ps1 -Domains @("project1.internal", "project2.internal")
# Or just run without args to add a wildcard comment

param(
    [string[]]$Domains = @()
)

$hostsPath = "C:\Windows\System32\drivers\etc\hosts"

# Check if running as admin
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "❌ This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host "Right-click PowerShell -> Run as Administrator" -ForegroundColor Yellow
    exit 1
}

$content = Get-Content $hostsPath -Raw

# Remove old DeployDock entries
$startMarker = "# === DeployDock Start ==="
$endMarker = "# === DeployDock End ==="

if ($content -match "(?s)# === DeployDock Start ===.*?# === DeployDock End ===") {
    $content = $content -replace "(?s)# === DeployDock Start ===.*?# === DeployDock End ===\r?\n?", ""
}

# If no domains specified, try to get them from the running backend
if ($Domains.Count -eq 0) {
    Write-Host "🔍 Fetching deployed projects from DeployDock..." -ForegroundColor Cyan
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:4000/api/projects" -Method Get -ErrorAction Stop
        if ($response.success -and $response.projects) {
            foreach ($project in $response.projects) {
                if ($project.internalDomain) {
                    $Domains += $project.internalDomain
                }
            }
        }
    } catch {
        Write-Host "⚠️  Could not reach DeployDock backend. Make sure it's running on port 4000." -ForegroundColor Yellow
        Write-Host "You can also specify domains manually:" -ForegroundColor Yellow
        Write-Host '  .\setup-hosts.ps1 -Domains @("myapp.internal", "api.internal")' -ForegroundColor Gray
        exit 1
    }
}

if ($Domains.Count -eq 0) {
    Write-Host "ℹ️  No projects deployed yet. Deploy a project first, then re-run this script." -ForegroundColor Yellow
    exit 0
}

# Build entries
$entries = "`n$startMarker`n"
foreach ($domain in $Domains) {
    $entries += "127.0.0.1    $domain`n"
    Write-Host "  ✅ $domain -> 127.0.0.1" -ForegroundColor Green
}
$entries += "$endMarker`n"

$content = $content.TrimEnd() + $entries
Set-Content -Path $hostsPath -Value $content -Force -NoNewline

Write-Host ""
Write-Host "✅ Hosts file updated successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Your projects are now accessible at:" -ForegroundColor Cyan
foreach ($domain in $Domains) {
    Write-Host "  🌐 http://${domain}:8080" -ForegroundColor White
}
Write-Host ""
Write-Host "💡 Tip: Re-run this script after deploying new projects to update DNS entries." -ForegroundColor Gray
