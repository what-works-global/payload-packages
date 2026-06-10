---
'@whatworks/payload-switch-env': minor
---

Auto-detect the installed Payload version. The `payloadVersion` plugin argument is now optional and acts as an override; when omitted, the plugin resolves the installed `payload` package's version at config build time by locating its package.json on the filesystem (no module resolution, so bundlers don't try to externalize or rewrite the lookup). This removes the drift risk of a hand-maintained version string silently selecting the wrong compatibility branch (hook timing at 3.70.0, client upload context at 3.83.0). If detection fails and no override is provided, the plugin throws a clear error at config build time.
