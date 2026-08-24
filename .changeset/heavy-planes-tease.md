---
'@whatworks/payload-video-webm': minor
---

Initial release — convert video uploads to WebM (VP9/Opus) in the upload pipeline, storage-adapter agnostic. Guardrails: `skipIfLarger`, `maxInputFileSize`, `maxConcurrentEncodes` (in-process limiter, default 2), encode timeouts, `onError: 'throw' | 'skip'`. Config: per-collection overrides via the `collections` object form, a `shouldConvert` veto predicate, an `onConversionComplete` observability callback covering every candidate decision, and init-time validation of encoding options. Boot-time ffmpeg check verifies the binary and the required libvpx/libopus encoders. A read-only `videoWebm` metadata group records original filename/mime/size, encode duration, and skip reasons.
