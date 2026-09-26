# Fixed voice assets

Production voice-assist mode expects one MP3 per `voiceKey` referenced by `assistant-core.js`:

- `checkin.mp3`, `dispatch.mp3`, `arrival-1.mp3`, `end.mp3`
- `load-1.mp3` through `load-6.mp3`
- `delivery-1.mp3` through `delivery-6.mp3`

These will be generated with the approved Marin voice after the final wording is locked. If an asset is absent or autoplay is rejected, the app falls back to its short generated alert tone. Background and lock-screen notifications always use the OS notification sound.
