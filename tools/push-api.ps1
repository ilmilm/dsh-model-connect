param(
  [Parameter(Mandatory = $true)][string]$SrcDir,
  [Parameter(Mandatory = $true)][string]$Owner,
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Branch = 'main'
)

# 无 git 二进制时的发布脚本：用 GitHub REST 的 git-data API 直推整棵树。
# 注意：所有 JSON 体必须以显式 UTF-8 字节发送，否则 Windows PowerShell 5.1
# 会把中文压成 '?'（commit message / description 都会中招）。
# 空仓库不接受 git-data API（409），所以这里用 force 更新 ref 的方式覆盖历史。
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
  Where-Object { $_.FullName -notmatch '\\\.git\\' } |
  ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1) -replace '\\', '/'
    $files += [pscustomobject]@{ Path = $rel; Full = $_.FullName }
  }
Write-Host "files: $($files.Count)"

$entries = @()
foreach ($f in $files) {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.Full))
  $blob = Send-Json 'POST' "$api/git/blobs" @{ content = $b64; encoding = 'base64' }
  $entries += @{ path = $f.Path; mode = '100644'; type = 'blob'; sha = $blob.sha }
  Write-Host ("  blob {0}  {1}" -f $blob.sha.Substring(0, 8), $f.Path)
}

# commit 1: 除 tools/ 之外的全部文件
$mainEntries = @($entries | Where-Object { $_.path -notlike 'tools/*' })
$tree1 = Send-Json 'POST' "$api/git/trees" @{ tree = $mainEntries }
$msg1 = @(
  'feat: DSH 模型接入侧边栏插件 v1.0.0',
  '',
  'Host 半：/model-connect/api 的 state / probe / save / remove 路由，',
  '走 settings + credentials 落盘，Key 只存 <ROUTE>_API_KEY 引用。',
  '浏览器半：侧边栏行 + 主区域面板，纯 JS 无构建步骤。'
) -join "`n"
$commit1 = Send-Json 'POST' "$api/git/commits" @{ message = $msg1; tree = $tree1.sha }
Write-Host "commit1: $($commit1.sha)"

# commit 2: 追加 tools/push-api.ps1
$tree2 = Send-Json 'POST' "$api/git/trees" @{ tree = $entries }
$msg2 = 'chore: 加入无 git 环境下的 REST 推送脚本 tools/push-api.ps1'
$commit2 = Send-Json 'POST' "$api/git/commits" @{ message = $msg2; tree = $tree2.sha; parents = @($commit1.sha) }
Write-Host "commit2: $($commit2.sha)"

Send-Json 'PATCH' "$api/git/refs/heads/$Branch" @{ sha = $commit2.sha; force = $true } | Out-Null
Write-Host "ref refs/heads/$Branch -> $($commit2.sha)"

$desc = 'DSH 侧边栏插件：图形界面接入第三方 OpenAI / Anthropic 兼容模型端点，探测模型列表并存为 pi-ai 路由'
Send-Json 'PATCH' $api @{ description = $desc } | Out-Null
Write-Host 'description updated'
Write-Host "DONE https://github.com/$Owner/$Repo"
