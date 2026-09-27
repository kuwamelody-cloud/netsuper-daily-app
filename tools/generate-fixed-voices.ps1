param([switch]$Force)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$audioDirectory = Join-Path $repoRoot 'audio'
$instructions = 'Voice: Professional, calm, and clear Japanese business guidance. Tone: Slightly brighter than a standard professional delivery, friendly and reassuring without sounding overly emotional. Delivery: Natural, steady, and easy to understand in a vehicle, with clear sentence endings and short natural pauses. Pronunciation: Native Japanese, crisp and accurate. Speed: Standard professional speaking speed. Keep the same voice character, tone, and pacing across every clip. Avoid robotic intonation, theatrical emphasis, exaggerated cheerfulness, whispering, or singing.'
$clips = [ordered]@{
  'checkin.mp3' = 'おはようございます！シンクロの着車報告は完了していますか？'
  'dispatch.mp3' = 'シンクロの出庫報告は完了していますか？'
  'arrival-1.mp3' = '1便、1件目の到着報告は完了していますか？'
  'load-1.mp3' = '1便、積み込み時刻になりました'
  'load-2.mp3' = '2便、積み込み時刻になりました'
  'load-3.mp3' = '3便、積み込み時刻になりました'
  'load-4.mp3' = '4便、積み込み時刻になりました'
  'load-5.mp3' = '5便、積み込み時刻になりました'
  'load-6.mp3' = '6便、積み込み時刻になりました'
  'delivery-1.mp3' = '1便、配達開始時刻になりました'
  'delivery-2.mp3' = '2便、配達開始時刻になりました'
  'delivery-3.mp3' = '3便、配達開始時刻になりました'
  'delivery-4.mp3' = '4便、配達開始時刻になりました'
  'delivery-5.mp3' = '5便、配達開始時刻になりました'
  'delivery-6.mp3' = '6便、配達開始時刻になりました'
  'completion.mp3' = 'お疲れ様でした！シンクロで業務終了報告をしてください。最後に、本日の業務データ入力も忘れずにお願いします'
  'end.mp3' = '業務終了が確認できていません。シンクロの操作は完了していますか？'
}

$apiKey = $env:OPENAI_API_KEY
$secretPointer = [IntPtr]::Zero
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  $secureKey = Read-Host 'OpenAI APIキーを入力してください（画面には表示されず、保存もしません）' -AsSecureString
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
}

try {
  New-Item -ItemType Directory -Path $audioDirectory -Force | Out-Null
  foreach ($entry in $clips.GetEnumerator()) {
    $destination = Join-Path $audioDirectory $entry.Key
    if ((Test-Path -LiteralPath $destination) -and -not $Force) {
      Write-Host "既存ファイルを維持: $($entry.Key)"
      continue
    }
    $body = @{
      model = 'gpt-4o-mini-tts'
      voice = 'marin'
      input = $entry.Value
      instructions = $instructions
      response_format = 'mp3'
      speed = 1.0
    } | ConvertTo-Json -Compress
    Invoke-WebRequest -Uri 'https://api.openai.com/v1/audio/speech' -Method Post -Headers @{ Authorization = "Bearer $apiKey" } -ContentType 'application/json; charset=utf-8' -Body $body -OutFile $destination
    Write-Host "生成完了: $($entry.Key)"
  }
  Write-Host '固定音声ファイルの生成が完了しました。'
} finally {
  $apiKey = $null
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
}
