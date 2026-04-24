# Hubei Proxy

This repository includes a lightweight proxy for Hubei local TV channels.

Endpoints after deployment:

- `/api/hubei-playlist`: M3U playlist for APTV
- `/api/proxy?channel=hubeiws`: Proxy endpoint that fetches the latest signed stream URL and adds the required headers
- `/api/proxy?url=<encoded m3u8 or segment url>`: Internal proxy form used after the first playlist hop

Recommended deployment:

1. Import this repository into Vercel.
2. Deploy the `codex/add-hubei-playlist` branch or merge it into `main`.
3. Copy the deployed `/api/hubei-playlist` URL into APTV.

Example:

```text
https://your-app.vercel.app/api/hubei-playlist
```
