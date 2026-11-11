Add-Type -AssemblyName System.Net
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = $PSScriptRoot
$port = 8802
# дозволені хости для /proxy (щоб сервер не став відкритим проксі)
$allowedHosts = @("t.me", "alerts.com.ua", "ubilling.net.ua", "api.dimap.live")

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
Write-Host "Server running: http://127.0.0.1:$port/index.html"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $res = $ctx.Response
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
    if ($path -eq "") { $path = "index.html" }

    if ($path -eq "alerts") {
      # --- офіційне API alerts.in.ua (токен у файлі alerts_token.txt) ---
      $tokenFile = Join-Path $root "alerts_token.txt"
      if (-not (Test-Path -LiteralPath $tokenFile)) {
        $res.StatusCode = 404
      } else {
        try {
          $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
          $req = [System.Net.HttpWebRequest]::Create("https://api.alerts.in.ua/v1/alerts/active.json")
          $req.Headers.Add("Authorization", "Bearer $token")
          $req.UserAgent = "radf4-threat-map"
          $req.Timeout = 15000
          $resp = $req.GetResponse()
          $ms = New-Object System.IO.MemoryStream
          $resp.GetResponseStream().CopyTo($ms)
          $resp.Close()
          $data = $ms.ToArray()
          $res.StatusCode = 200
          $res.ContentType = "application/json; charset=utf-8"
          $res.OutputStream.Write($data, 0, $data.Length)
        } catch {
          $res.StatusCode = 502
        }
      }
    } elseif ($path -eq "proxy") {
      # --- режим проксі: читаємо зовнішні сайти без обмежень CORS ---
      $url = $ctx.Request.QueryString["url"]
      try {
        $uri = [System.Uri]$url
        if ($uri.Scheme -ne "https" -or $allowedHosts -notcontains $uri.Host) { throw "host not allowed" }
        $req = [System.Net.HttpWebRequest]::Create($uri)
        $req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        $req.Timeout = 15000
        $req.ReadWriteTimeout = 15000
        $req.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
        $resp = $req.GetResponse()
        $ms = New-Object System.IO.MemoryStream
        $resp.GetResponseStream().CopyTo($ms)
        $resp.Close()
        $data = $ms.ToArray()
        $res.StatusCode = 200
        $res.ContentType = "text/plain; charset=utf-8"
        $res.Headers.Add("Access-Control-Allow-Origin", "*")
        $res.OutputStream.Write($data, 0, $data.Length)
      } catch {
        $res.StatusCode = 502
      }
    } else {
      # --- статичні файли карти ---
      $file = [System.IO.Path]::GetFullPath((Join-Path $root $path))
      # захист від виходу за межі папки (../)
      if ($file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $res.StatusCode = 200
        $res.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")
        $res.Headers.Add("Pragma", "no-cache")
        $res.Headers.Add("Expires", "0")
        if ($file -match "\.html$") { $res.ContentType = "text/html; charset=utf-8" }
        else { $res.ContentType = "application/octet-stream" }
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $res.StatusCode = 404 }
    }
  } catch {
    try { $ctx.Response.StatusCode = 500 } catch {}
  }
  try { $ctx.Response.Close() } catch {}
}
