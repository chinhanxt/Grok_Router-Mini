# ==============================================================================
# AI Claude KeyAPI - Windows 1-Click Installer (Auto-setup Node.js & npm)
# ==============================================================================

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   ⚡ AI Claude KeyAPI - Trình cài đặt tự động (1-Click)       " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Kiểm tra môi trường Node.js và npm
$nodeInstalled = $false
try {
    $nodeVer = & node -v 2>$null
    $npmVer = & npm -v 2>$null
    if ($nodeVer -and $npmVer) {
        $nodeInstalled = $true
    }
} catch {
    $nodeInstalled = $false
}

if (-not $nodeInstalled) {
    Write-Host "[1/3] Máy chưa có Node.js / npm. Đang tiến hành cài đặt tự động..." -ForegroundColor Yellow
    
    $installedViaWinget = $false
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            Write-Host ">> Đang cài đặt Node.js LTS qua Windows Package Manager (winget)..." -ForegroundColor Gray
            & winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
            $installedViaWinget = $true
        } catch {
            $installedViaWinget = $false
        }
    }
    
    if (-not $installedViaWinget) {
        Write-Host ">> Đang tải gói cài đặt Node.js LTS chính thức từ nodejs.org..." -ForegroundColor Gray
        $msiUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
        $tempMsi = "$env:TEMP\nodejs-lts-installer.msi"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $msiUrl -OutFile $tempMsi -UseBasicParsing
        
        Write-Host ">> Đang cài đặt Node.js (tự động chạy ngầm, vui lòng đợi 30s)..." -ForegroundColor Gray
        $process = Start-Process msiexec.exe -ArgumentList "/i `"$tempMsi`" /qn" -Wait -PassThru
        Remove-Item $tempMsi -Force -ErrorAction SilentlyContinue
    }
    
    # Nạp lại biến môi trường PATH để nhận diện lệnh node và npm ngay lập tức
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
    
    # Kiểm tra lại lần nữa
    try {
        $nodeVer = & node -v 2>$null
        $npmVer = & npm -v 2>$null
        Write-Host "✓ Đã cài đặt Node.js $nodeVer và npm $npmVer thành công!" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ Đã cài đặt Node.js nhưng cần mở lại cửa sổ PowerShell mới để nhận diện lệnh 'npm'." -ForegroundColor Yellow
        Write-Host "Vui lòng tắt cửa sổ này, mở lại PowerShell và chạy: npm install -g ai-claude-keyapi" -ForegroundColor Yellow
        return
    }
} else {
    Write-Host "[1/3] ✓ Đã phát hiện Node.js ($nodeVer) và npm ($npmVer)." -ForegroundColor Green
}

# 2. Cài đặt ai-claude-keyapi
Write-Host ""
Write-Host "[2/3] Đang cài đặt gói ai-claude-keyapi mới nhất..." -ForegroundColor Yellow
& npm install -g ai-claude-keyapi@latest

# 3. Hoàn tất
Write-Host ""
Write-Host "[3/3] 🎉 Cài đặt hoàn tất 100%!" -ForegroundColor Green
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  Khởi động cổng Gateway bằng lệnh:                             " -ForegroundColor White
Write-Host "  > aiclaude                                                    " -ForegroundColor Yellow
Write-Host "  (Hoặc truy cập: http://localhost:3005 sau khi chạy)           " -ForegroundColor Gray
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

# Tự khởi động
$ans = Read-Host "Bạn có muốn khởi động aiclaude ngay bây giờ? (Y/n)"
if ($ans -eq '' -or $ans -match '^[Yy]') {
    & aiclaude
}
