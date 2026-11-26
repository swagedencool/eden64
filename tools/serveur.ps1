# eden64 : mini serveur HTTP local, sans aucune installation (PowerShell intégré à Windows)
# Sert ce dossier sur http://localhost:8064 avec les en-têtes d'isolation cross-origin (COOP/COEP).
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\web'))
$roms = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\roms'))
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.wasm' = 'application/wasm'
  '.data' = 'application/octet-stream'; '.woff2' = 'font/woff2'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.webmanifest' = 'application/manifest+json'
  '.txt' = 'text/plain; charset=utf-8'
}

# Trouve un port libre entre 8064 et 8073
$listener = $null
foreach ($port in 8064..8073) {
  $candidate = New-Object System.Net.HttpListener
  $candidate.Prefixes.Add("http://localhost:$port/")
  try { $candidate.Start(); $listener = $candidate; break } catch { $candidate.Close() }
}
if (-not $listener) {
  Write-Host "Aucun port libre entre 8064 et 8073." -ForegroundColor Red
  Read-Host "Appuie sur Entrée pour fermer"
  exit 1
}
$url = $listener.Prefixes | Select-Object -First 1
Write-Host ""
Write-Host "  eden64 est en ligne sur $url" -ForegroundColor Green
Write-Host "  Laisse cette fenêtre ouverte pendant que tu joues ; ferme-la pour arrêter le serveur."
Write-Host ""
Start-Process $url

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($path.EndsWith('/')) { $path += 'index.html' }
    if ($path -eq '/roms/index.json') {
      # Ludothèque locale : liste des dumps déposés dans roms\ (jamais publiés avec le site)
      $romDir = $roms
      if (-not (Test-Path $romDir)) { New-Item -ItemType Directory -Path $romDir | Out-Null }
      $items = @(Get-ChildItem -LiteralPath $romDir -File | Where-Object { $_.Extension -match '^\.(z64|n64|v64|zip)$' } | ForEach-Object { [ordered]@{ file = $_.Name; size = $_.Length } })
      $json = if ($items.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $items -Compress -Depth 3 }
      $bytes = [Text.Encoding]::UTF8.GetBytes($json)
      $res.Headers.Add('Cross-Origin-Opener-Policy', 'same-origin')
      $res.Headers.Add('Cross-Origin-Embedder-Policy', 'require-corp')
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.ContentType = 'application/json; charset=utf-8'
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  200 GET /roms/index.json ({0} jeu(x))" -f $items.Count)
      continue
    }
    $dir = if ($path.StartsWith('/roms/')) { $roms } else { $root }
    $rel = if ($path.StartsWith('/roms/')) { $path.Substring(6) } else { $path.TrimStart('/') }
    $full = [IO.Path]::GetFullPath([IO.Path]::Combine($dir, $rel.Replace('/', '\')))
    $res.Headers.Add('Cross-Origin-Opener-Policy', 'same-origin')
    $res.Headers.Add('Cross-Origin-Embedder-Policy', 'require-corp')
    $res.Headers.Add('Cross-Origin-Resource-Policy', 'same-origin')
    $res.Headers.Add('Cache-Control', 'no-cache')
    if (-not $full.StartsWith($dir + '\', [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($full)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('404')
      $res.ContentType = 'text/plain; charset=utf-8'
    } else {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($full)
    }
    $res.ContentLength64 = $bytes.Length
    if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    Write-Host ("  {0} {1} {2}" -f $res.StatusCode, $req.HttpMethod, $path)
  } catch {
    Write-Host ("  Erreur : " + $_.Exception.Message) -ForegroundColor Yellow
  } finally {
    try { $res.Close() } catch {}
  }
}
