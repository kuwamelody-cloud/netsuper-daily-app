# Fixed voice assets

These MP3 files are generated once during development and bundled with the PWA. The app never calls a speech-generation API during normal use. Background and lock-screen notifications continue to use the operating system's notification sound.

The active set was supplied as 48 kHz, 16-bit mono WAV files and converted to 128 kbps MP3 without changing the wording or playback speed. All 17 clips are bundled and pre-cached for offline foreground playback. If a file cannot be played, the app automatically uses its short alert tone.

## Earlier Marin generation reference

- Model: `gpt-4o-mini-tts`
- Voice: `marin`
- Output: MP3
- Speed: `1.0` (default)
- Source: OpenAI.fm / OpenAI Audio Speech API

The following Instructions text must be used unchanged when adding or regenerating clips:

> Voice: Professional, calm, and clear Japanese business guidance. Tone: Slightly brighter than a standard professional delivery, friendly and reassuring without sounding overly emotional. Delivery: Natural, steady, and easy to understand in a vehicle, with clear sentence endings and short natural pauses. Pronunciation: Native Japanese, crisp and accurate. Speed: Standard professional speaking speed. Keep the same voice character, tone, and pacing across every clip. Avoid robotic intonation, theatrical emphasis, exaggerated cheerfulness, whispering, or singing.

## File map

| File | Script |
| --- | --- |
| `checkin.mp3` | おはようございます！シンクロの着車報告は完了していますか？ |
| `dispatch.mp3` | シンクロの出庫報告は完了していますか？ |
| `arrival-1.mp3` | 1便、1件目の到着報告は完了していますか？ |
| `load-1.mp3` | 1便、積み込み時刻になりました |
| `load-2.mp3` | 2便、積み込み時刻になりました |
| `load-3.mp3` | 3便、積み込み時刻になりました |
| `load-4.mp3` | 4便、積み込み時刻になりました |
| `load-5.mp3` | 5便、積み込み時刻になりました |
| `load-6.mp3` | 6便、積み込み時刻になりました |
| `delivery-1.mp3` | 1便、配達開始時刻になりました |
| `delivery-2.mp3` | 2便、配達開始時刻になりました |
| `delivery-3.mp3` | 3便、配達開始時刻になりました |
| `delivery-4.mp3` | 4便、配達開始時刻になりました |
| `delivery-5.mp3` | 5便、配達開始時刻になりました |
| `delivery-6.mp3` | 6便、配達開始時刻になりました |
| `completion.mp3` | お疲れ様でした！シンクロで業務終了報告をしてください。最後に、本日の業務データ入力も忘れずにお願いします |
| `end.mp3` | 業務終了が確認できていません。シンクロの操作は完了していますか？ |

Information clips (`load-*` and `delivery-*`) follow the configured repeat count. Confirmation clips and the two end-of-day clips play once.
