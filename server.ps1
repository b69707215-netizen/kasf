Add-Type -AssemblyName System.Net
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::DefaultConnectionLimit = 64
$base = $PSScriptRoot
$root = Join-Path $PSScriptRoot "public"   # the site lives in public/ (same as on Cloudflare)
$port = if ($env:KARTA_PORT) { [int]$env:KARTA_PORT } else { 8802 }
# hosts allowed for /proxy (so the server does not become an open proxy)
$allowedHosts = @("t.me", "api.dimap.live", "map.ukrainealarm.com")

# Each request is handled in its own runspace (parallel). Before: one request at a time, so one slow
# upstream (up to 15 s) froze the whole page and data arrived late or not at all.
$handler = {
  param($ctx, $root, $base, $allowedHosts)

  function Get-Remote([string]$url, $headers) {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    $req.Timeout = 8000
    $req.ReadWriteTimeout = 8000
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($headers) { foreach ($k in $headers.Keys) { $req.Headers.Add($k, $headers[$k]) } }
    $resp = $req.GetResponse()
    $ms = New-Object System.IO.MemoryStream
    $resp.GetResponseStream().CopyTo($ms)
    $resp.Close()
    return ,$ms.ToArray()
  }

  $res = $ctx.Response
  try {
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart("/")
    if ($path -eq "") { $path = "index.html" }

    if ($path -eq "alerts") {
      # --- official alerts.in.ua API (token in alerts_token.txt) ---
      $tokenFile = Join-Path $base "alerts_token.txt"
      if (-not (Test-Path -LiteralPath $tokenFile)) { $res.StatusCode = 404 }
      else {
        try {
          $token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
          $data = Get-Remote "https://api.alerts.in.ua/v1/alerts/active.json" @{ Authorization = "Bearer $token" }
          $res.StatusCode = 200
          $res.ContentType = "application/json; charset=utf-8"
          $res.OutputStream.Write($data, 0, $data.Length)
        } catch { $res.StatusCode = 502 }
      }
    } elseif ($path -eq "ua-alerts") {
      # --- Ukraine Alarm: districts / communities / oblasts. Same shape as the Cloudflare /ua-alerts (array of regions).
      #     Taken from the public map data, no key needed locally. ---
      try {
        $raw = Get-Remote "https://map.ukrainealarm.com/api/v2/data/mapUpdate" $null
        $j = [System.Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json
        $json = ConvertTo-Json -InputObject @($j.alerts) -Depth 20 -Compress
        $data = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.StatusCode = 200
        $res.ContentType = "application/json; charset=utf-8"
        $res.Headers.Add("Cache-Control", "no-store")
        $res.OutputStream.Write($data, 0, $data.Length)
      } catch { $res.StatusCode = 502 }
    } elseif ($path -eq "proxy") {
      # --- proxy mode: read external sites without CORS limits ---
      $url = $ctx.Request.QueryString["url"]
      try {
        $uri = [System.Uri]$url
        if ($uri.Scheme -ne "https" -or $allowedHosts -notcontains $uri.Host) { throw "host not allowed" }
        $data = Get-Remote $uri.AbsoluteUri $null
        $res.StatusCode = 200
        $res.ContentType = "text/plain; charset=utf-8"
        $res.Headers.Add("Access-Control-Allow-Origin", "*")
        $res.Headers.Add("Cache-Control", "no-store")
        $res.OutputStream.Write($data, 0, $data.Length)
      } catch { $res.StatusCode = 502 }
    } else {
      # --- static files of the map ---
      $file = [System.IO.Path]::GetFullPath((Join-Path $root $path))
      # protection against leaving the folder (../)
      if ($file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $res.StatusCode = 200
        $res.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")
        $res.Headers.Add("Pragma", "no-cache")
        $res.Headers.Add("Expires", "0")
        switch -Regex ($file) {
          "\.html$"                { $res.ContentType = "text/html; charset=utf-8" }
          "\.js$"                  { $res.ContentType = "application/javascript; charset=utf-8" }
          "\.css$"                 { $res.ContentType = "text/css; charset=utf-8" }
          "\.json$"                { $res.ContentType = "application/json; charset=utf-8" }
          "\.webmanifest$"         { $res.ContentType = "application/manifest+json; charset=utf-8" }
          "\.png$"                 { $res.ContentType = "image/png" }
          "\.svg$"                 { $res.ContentType = "image/svg+xml" }
          default                  { $res.ContentType = "application/octet-stream" }
        }
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $res.StatusCode = 404 }
    }
  } catch {
    try { $res.StatusCode = 500 } catch {}
  }
  try { $res.Close() } catch {}
}

$pool = [runspacefactory]::CreateRunspacePool(1, 24)
$pool.Open()
$jobs = New-Object System.Collections.ArrayList

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
Write-Host "Server running: http://127.0.0.1:$port/index.html"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  # clean up finished requests
  for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
    if ($jobs[$i].Handle.IsCompleted) {
      try { $jobs[$i].Ps.EndInvoke($jobs[$i].Handle) } catch {}
      $jobs[$i].Ps.Dispose()
      $jobs.RemoveAt($i)
    }
  }
  $ps = [powershell]::Create()
  $ps.RunspacePool = $pool
  [void]$ps.AddScript($handler).AddArgument($ctx).AddArgument($root).AddArgument($base).AddArgument($allowedHosts)
  [void]$jobs.Add([pscustomobject]@{ Ps = $ps; Handle = $ps.BeginInvoke() })
}
