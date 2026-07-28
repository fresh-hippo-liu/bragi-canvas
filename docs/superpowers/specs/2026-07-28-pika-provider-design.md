# Pika provider design

## Goal

Add Pika as a video provider for the Kling models that already exist in Bragi
Canvas, using exact model-family matches and without introducing a new model.

## Model mapping

| Bragi model | Pika media route family | Effective Bragi modes |
| --- | --- | --- |
| Kling 3.0 (`kling-3.0`) | `kling-v3` | `text-to-video`, `first-frame`, `motion-control` |
| Kling 3.0 Omni (`kling-3.0-omni`) | `kling-o3` | `first-frame` |
| Kling 2.6 (`kling-2.6`) | None | None |

Pika's `kling-o1` route is intentionally excluded. Kling O1 is the predecessor
of Kling 3.0 Omni rather than the same model, and Bragi does not currently have a
Kling O1 catalogue entry. Adding it would be a separate model-addition change.

## Pika endpoints

The provider uses `https://api.dev.pika.art` with `X-API-Key` authentication.

Kling 3.0 is routed by Bragi mode and quality:

- `POST /v1/media/kling/kling-v3/{standard|pro|4k}/text-to-video`
- `POST /v1/media/kling/kling-v3/{standard|pro|4k}/image-to-video`
- `POST /v1/media/kling/kling-v3/motion-control`

Kling 3.0 Omni uses:

- `POST /v1/media/kling/kling-o3/image-to-video`

All submitted jobs use the shared Pika status API:

- `GET /v1/media/jobs/{request_id}`
- `GET /v1/media/jobs/{request_id}/content` when the completed status payload
  does not already include a usable video URL

## Catalogue behavior

Pika is added to `supportedProviders` only for the two exact model matches.
Kling 3.0 is marked as aggregated for Pika because the provider routes one Bragi
model to multiple Pika endpoints. Its Pika mode list excludes
`first-last-frame`, which Pika does not expose.

The existing Kling quality parameter receives a Pika override with Standard,
Pro, and 4K options. Kling 3.0 Omni's Pika mapping hides quality because the O3
endpoint has no quality selector. Existing duration, ratio, audio, and
motion-control parameters are reused where Pika accepts them; unsupported
parameters are omitted from the request rather than sent speculatively.

Adding Pika support must not enable a model or connect Pika to a model for
existing users. The normal Add Provider and Manage Models flows remain the only
way to enable the new connection.

## Reference media

Pika receives public HTTPS URLs. Bragi continues to prepare local reference
images and videos through its built-in temporary relay before invoking the
provider.

Request mapping:

- Kling 3.0 image-to-video: first image becomes `image`.
- Kling 3.0 Omni image-to-video: first image becomes `image_url`.
- Kling 3.0 motion control: first image becomes `image_url`; first video becomes
  `video_url`.

Missing required reference media fails locally with a provider-specific error
before submission.

## Provider lifecycle

`PikaVideoProvider` implements Bragi's existing `VideoProvider` interface.

1. Validate the active model, generation mode, required references, duration,
   quality, and Pika-supported values.
2. Build the mode-specific Pika request without mutating input params.
3. Submit the request with the configured API key.
4. Return `{ done: false, taskId }`.
5. Poll the shared job endpoint from `checkStatus`.
6. Return pending for `queued` and `running`.
7. On `completed`, resolve the video URL from the job payload or content
   endpoint, download it, and write it under the configured output directory.
8. On `failed` or malformed responses, throw a redacted error that never
   includes the API key.

## Settings and connection test

Add `providers.pika` as a password field with an empty default. The centralized
settings migration/parser picks up the new default-backed string field, and the
settings schema version is advanced explicitly.

The provider registry exposes Pika with video support and relay delivery for
images and videos. Its connection test calls a non-generating authenticated API
endpoint so Test Connection does not consume media credits.

No API key, generated media URL, or live-test asset is stored in the repository.

## Testing and verification

Implementation follows test-first development:

- Payload tests cover each supported Kling 3.0 mode and the Kling O3 mapping.
- Validation tests cover unsupported modes, missing references, invalid quality,
  and out-of-range values.
- Provider tests cover authenticated submission, queued/running/completed/failed
  polling, content URL fallback, and vault download behavior with stubbed
  network responses.
- Wiring tests cover settings defaults and migration, registry setup, catalogue
  mappings, mode restrictions, parameter overrides, and package scripts.

Before the PR is opened, run:

- the Pika-specific verification script
- `npm run check:catalog`
- `npm run audit:catalog`
- existing Kling verification
- `npm run lint:obsidian`
- `npm run build`
- `git diff --check`

Live API verification is limited to authenticated, non-generating validation
requests unless explicit approval is given to spend Pika generation credits.

## Documentation coupling

The plugin repository requires model/provider changes to be reflected in
`nextbound/bragi-canvas-skill`. The plugin PR must call out the corresponding
skill documentation update. If a paired skill PR cannot be created from the
current workspace, that dependency must be reported explicitly rather than
silently omitted.
