param(
  [Parameter(Mandatory = $true)][string]$SrcDir,
  [Parameter(Mandatory = $true)][string]$Owner,
  [Parameter(Mandatory = $true)][string]$Repo,
  [Parameter(Mandatory = $true)][string]$Message,
  [string]$Branch = 'main'
)

# 无 git 二进制时用 GitHub REST 的 git-data API 发布整棵树。
# 行为：在 $Branch 当前 HEAD 之上追加一条提交（force=false，不丢历史）；
# 分支还不存在时先用 contents API 种下第一个提交（空仓库对 git-data API 返回 409）。
#
# 注意：所有 JSON 体必须以显式 UTF-8 字节发送，否则 Windows PowerShell 5.1
# 会把中文压成 '?'（commit message 会中招）。本文件须以 UTF-8 BOM 保存。
$ErrorActionPreference = 'Stop'
$token = $env:GH_TOKEN
if (-not $token) { throw 'GH_TOKEN env var is required' }

$headers = @{
  Authorization          = "token $token"
  'User-Agent'           = 'dsh-agent'
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$api = "https://api.github.com/repos/$Owner/$Repo"

function Send-Json([string]$method, [string]$uri, $obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
}

$root = (Resolve-Path $SrcDir).Path
$files = @()
Get-ChildItem -LiteralPath $root -Recurse -File -Force |
  Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.FullName -notmatch '\\node_modules\\' } |
  ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
    $files += [pscustomobject]@{ Path = $rel; Full = $_.FullName }
  }
Write-Host "files: $($files.Count)"

# --- parent (or seed an empty repo) ---
$parent = $null
try {
  $parent = (Invoke-RestMethod -Uri "$api/git/ref/heads/$Branch" -Headers $headers -TimeoutSec 30).object.sha
  Write-Host "parent: $parent"
} catch {
  $seed = $files | Select-Object -First 1
  $seedB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($seed.Full))
  $seeded = Send-Json 'PUT' "$api/contents/$($seed.Path)" @{ message = 'chore: seed repository'; content = $seedB64; branch = $Branch }
  $parent = $seeded.commit.sha
  Write-Host "seeded $($seed.Path) -> $parent"
}

# --- blobs + tree ---
$entries = @()
foreach ($f in $files) {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.Full))
  $blob = Send-Json 'POST' "$api/git/blobs" @{ content = $b64; encoding = 'base64' }
  $entries += @{ path = $f.Path; mode = '100644'; type = 'blob'; sha = $blob.sha }
  Write-Host ("  blob {0}  {1}" -f $blob.sha.Substring(0, 8), $f.Path)
}
$tree = Send-Json 'POST' "$api/git/trees" @{ tree = $entries }
Write-Host "tree: $($tree.sha)"

# --- commit on top of the branch ---
$commit = Send-Json 'POST' "$api/git/commits" @{ message = $Message; tree = $tree.sha; parents = @($parent) }
Write-Host "commit: $($commit.sha)"

Send-Json 'PATCH' "$api/git/refs/heads/$Branch" @{ sha = $commit.sha; force = $false } | Out-Null
Write-Host "ref refs/heads/$Branch -> $($commit.sha)"
Write-Host "DONE https://github.com/$Owner/$Repo"
