# Run this script as Administrator to enable .internal domains
# Right-click PowerShell → Run as Administrator → then run this script

$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
$content = Get-Content $hostsPath -Raw

# Remove old DeployDock entries
$content = $content -replace '(?s)# === DeployDock Start ===.*?# === DeployDock End ===\r?\n?', ''

# Add new entries
$entries = @"
# === DeployDock Start ===
127.0.0.1    frontend.internal
# === DeployDock End ===
"@

$content = $content.TrimEnd() + "\n" + $entries
Set-Content -Path $hostsPath -Value $content -Force
Write-Host "✅ Hosts file updated! Your .internal domains are now active." -ForegroundColor Green
