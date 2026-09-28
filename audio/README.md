# Fixed voice assets

These MP3 files are generated once during development and bundled with the PWA. The app never calls a speech-generation API during normal use. Background and lock-screen notifications continue to use the operating system's notification sound.

The active set was supplied as 48 kHz, 16-bit mono WAV files and converted to 128 kbps MP3 without changing the wording or playback speed. Only the explicit business-start and business-end clips are bundled and pre-cached for offline playback. Scheduled notices and ShinQLO confirmations use the operating system's notification sound. If either fixed clip cannot be played, the app automatically uses its short alert tone.

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
| `completion.mp3` | お疲れ様でした！シンクロで業務終了報告をしてください。最後に、本日の業務データ入力も忘れずにお願いします |
