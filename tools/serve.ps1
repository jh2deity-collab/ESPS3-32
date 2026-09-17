<#
    ESPS3-32 I/O 테스트 콘솔 - 로컬 서버 (PowerShell 판)

    파이썬이 없는 윈도우에서도 아무것도 설치하지 않고 콘솔을 띄우기 위한 것.
    윈도우에는 PowerShell 이 기본 탑재되어 있다.

        powershell -ExecutionPolicy Bypass -File tools\serve.ps1
        powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 9000

    파이썬이 있다면 tools/serve.py 쪽이 더 빠르다.
    PowerShell 5.1(윈도우 기본) 과 7.x 모두에서 동작하도록 작성했다.
#>
param(
    [int]$Port = 8000,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root = Join-Path (Split-Path -Parent $PSScriptRoot) 'web'
if (-not (Test-Path -LiteralPath $root)) {
    Write-Host ''
    Write-Host '[오류] web 폴더를 찾을 수 없습니다:' -ForegroundColor Red
    Write-Host "       $root"
    Write-Host '       저장소를 통째로 받았는지 확인해 주세요.'
    Write-Host ''
    exit 1
}
$root = (Resolve-Path -LiteralPath $root).Path

$required = @('index.html', 'css\app.css', 'js\app.js', 'js\protocol.js', 'vendor\esptool-js\esptool.js')
$missing = @()
foreach ($f in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $f))) { $missing += $f }
}
if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host '[오류] 파일이 빠져 있습니다:' -ForegroundColor Red
    foreach ($f in $missing) { Write-Host "         web\$f" }
    Write-Host '       저장소를 다시 받아 주세요.'
    Write-Host ''
    exit 1
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.ico'  = 'image/x-icon'
    '.map'  = 'application/json'
    '.txt'  = 'text/plain; charset=utf-8'
    '.bin'  = 'application/octet-stream'
}

# --- 빈 포트 찾기 ----------------------------------------------------------
$listener = $null
$bound = 0
for ($p = $Port; $p -lt ($Port + 20); $p++) {
    try {
        $candidate = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
        $candidate.Start()
        $listener = $candidate
        $bound = $p
        break
    } catch {
        if ($p -eq $Port) { Write-Host "  포트 $Port 는 이미 사용 중입니다. 다음 포트를 찾습니다..." }
    }
}
if ($null -eq $listener) {
    Write-Host ''
    Write-Host "[오류] $Port ~ $($Port + 19) 사이에 빈 포트가 없습니다." -ForegroundColor Red
    Write-Host '       다른 포트를 지정해 보세요:  -Port 9000'
    Write-Host ''
    exit 1
}

$url = "http://localhost:$bound/"
Write-Host ''
Write-Host '  ESPS3-32 I/O 테스트 콘솔'
Write-Host '  ------------------------------------------'
Write-Host "  주소       : $url"
Write-Host "  폴더       : $root"
Write-Host "  PowerShell : $($PSVersionTable.PSVersion)"
Write-Host ''
Write-Host '  브라우저에서 위 주소를 여세요. 반드시 localhost 로 열어야'
Write-Host '  USB·블루투스 연결이 동작합니다(파일을 직접 열면 안 됩니다).'
Write-Host '  종료하려면 Ctrl+C'
Write-Host ''

if (-not $NoBrowser) {
    try { Start-Process $url } catch { }
}

function Send-Response {
    param($Stream, [int]$Code, [string]$Reason, [string]$ContentType, [byte[]]$Body)

    $head = "HTTP/1.1 $Code $Reason`r`n" +
            "Content-Type: $ContentType`r`n" +
            "Content-Length: $($Body.Length)`r`n" +
            "Cache-Control: no-store, must-revalidate`r`n" +
            "Connection: close`r`n`r`n"
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $Stream.Write($headBytes, 0, $headBytes.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 2000
            $client.SendTimeout = 15000
            $stream = $client.GetStream()

            # 브라우저는 미리 연결만 열어 두고 아무것도 보내지 않기도 한다.
            # 그런 연결에 오래 매달리지 않도록 잠깐만 기다린다.
            $deadline = [DateTime]::UtcNow.AddMilliseconds(1200)
            while (-not $stream.DataAvailable -and [DateTime]::UtcNow -lt $deadline) {
                Start-Sleep -Milliseconds 5
            }
            if (-not $stream.DataAvailable) { $client.Close(); continue }

            # 요청 헤더만 읽는다 (GET 이라 본문이 없다)
            $buffer = New-Object byte[] 8192
            $sb = New-Object System.Text.StringBuilder
            while ($true) {
                $n = $stream.Read($buffer, 0, $buffer.Length)
                if ($n -le 0) { break }
                [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buffer, 0, $n))
                if ($sb.ToString().Contains("`r`n`r`n")) { break }
                if ($sb.Length -gt 65536) { break }
            }
            $request = $sb.ToString()
            if ($request.Length -eq 0) { $client.Close(); continue }

            $firstLine = ($request -split "`r`n")[0]
            $parts = $firstLine -split ' '
            if ($parts.Count -lt 2) { $client.Close(); continue }
            $method = $parts[0]
            $target = $parts[1]

            # 쿼리스트링 제거 + URL 디코드
            $path = $target.Split('?')[0]
            $path = [System.Uri]::UnescapeDataString($path)
            if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }

            $rel = $path.TrimStart('/').Replace('/', '\')
            $full = Join-Path $root $rel

            $status = 200
            $bodyBytes = $null
            $type = 'application/octet-stream'

            # 경로 탈출 차단: 반드시 web 폴더 안이어야 한다
            $resolved = $null
            try { $resolved = (Resolve-Path -LiteralPath $full -ErrorAction Stop).Path } catch { }

            if ($method -ne 'GET' -and $method -ne 'HEAD') {
                $status = 405
                $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes('405 Method Not Allowed')
                $type = 'text/plain; charset=utf-8'
            } elseif ($null -eq $resolved -or -not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
                $status = 404
                $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
                $type = 'text/plain; charset=utf-8'
            } else {
                $bodyBytes = [System.IO.File]::ReadAllBytes($resolved)
                $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
                if ($mime.ContainsKey($ext)) { $type = $mime[$ext] }
            }

            if ($method -eq 'HEAD') { $bodyBytes = New-Object byte[] 0 }

            $reason = 'OK'
            if ($status -eq 404) { $reason = 'Not Found' }
            if ($status -eq 405) { $reason = 'Method Not Allowed' }
            Send-Response -Stream $stream -Code $status -Reason $reason -ContentType $type -Body $bodyBytes

            $color = 'DarkGray'
            if ($status -ne 200) { $color = 'Yellow' }
            Write-Host ("  {0} {1} {2}" -f $status, $method, $path) -ForegroundColor $color
        } catch {
            # 연결이 중간에 끊기는 것은 흔한 일이라 조용히 넘어간다
        } finally {
            try { $client.Close() } catch { }
        }
    }
} finally {
    $listener.Stop()
    Write-Host ''
    Write-Host '  서버를 종료합니다.'
}
