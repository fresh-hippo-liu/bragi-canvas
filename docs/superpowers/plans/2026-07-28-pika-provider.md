# Pika Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pika as a configured video provider for Bragi's existing Kling 3.0 and Kling 3.0 Omni models, with exact mode restrictions and no Kling O1 catalogue entry.

**Architecture:** A focused `PikaVideoProvider` owns Pika request routing, validation, polling, and downloads behind Bragi's existing `VideoProvider` interface. Catalogue data restricts Pika to the exact model/mode matches, while registry and settings changes expose one API-key field and preserve opt-in model connections.

**Tech Stack:** TypeScript 5.8, Obsidian `requestUrl`, esbuild, Node assertion-based verification scripts, existing Bragi catalogue and settings migration helpers.

## Global Constraints

- Do not add a Kling O1 model or map Pika Kling O1 to Kling 3.0 Omni.
- Pika supports Kling 3.0 modes `text-to-video`, `first-frame`, and `motion-control`; it does not support `first-last-frame`.
- Pika Kling O3 maps only to Bragi Kling 3.0 Omni `first-frame`.
- Pika reference images and videos use Bragi Relay HTTPS URLs.
- Newly supported provider/model pairs remain disabled until the user explicitly connects them.
- Never store or log the supplied Pika API key, temporary URLs, or live-test media.
- Use sentence case for all user-visible copy.
- Run `npm run lint:obsidian`, `npm run build`, catalogue checks, and `git diff --check` before the PR.

---

### Task 1: Pika request routing and async provider lifecycle

**Files:**
- Create: `src/providers/pika.ts`
- Create: `scripts/verify-pika-provider.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `VideoProvider`, `GenerateVideoResult`, Obsidian `App`, and `requestUrl`.
- Produces: `buildPikaVideoRequest(prompt: string, params?: Record<string, unknown>): { path: string; body: Record<string, unknown> }`, `PikaVideoProvider`, and `testPikaConnection(apiKey: string)`.

- [ ] **Step 1: Write the failing payload and lifecycle verification**

Create `scripts/verify-pika-provider.mjs`. Bundle `src/providers/pika.ts` through
esbuild with an `obsidian` stub whose `requestUrl` records requests and returns
queued responses. Assert these exact payload contracts:

```js
const stdText = buildPikaVideoRequest('A slow pan', {
  modelId: 'kling-v3',
  genMode: 'text-to-video',
  mode: 'std',
  duration: '5',
  aspect_ratio: '16:9',
})
assert.equal(stdText.path, '/v1/media/kling/kling-v3/standard/text-to-video')
assert.deepEqual(stdText.body, {
  prompt: 'A slow pan',
  duration: '5',
  aspect_ratio: '16:9',
})

const proImage = buildPikaVideoRequest('Blink and smile', {
  modelId: 'kling-v3',
  genMode: 'first-frame',
  mode: 'pro',
  duration: '10',
  aspect_ratio: '9:16',
  refImages: ['https://relay.example/start.png'],
})
assert.equal(proImage.path, '/v1/media/kling/kling-v3/pro/image-to-video')
assert.equal(proImage.body.image, 'https://relay.example/start.png')

const motion = buildPikaVideoRequest('Follow the dance', {
  modelId: 'kling-v3',
  genMode: 'motion-control',
  refImages: ['https://relay.example/character.png'],
  refVideos: ['https://relay.example/motion.mp4'],
  character_orientation: 'video',
  keep_original_sound: 'yes',
})
assert.equal(motion.path, '/v1/media/kling/kling-v3/motion-control')
assert.deepEqual(motion.body, {
  prompt: 'Follow the dance',
  image_url: 'https://relay.example/character.png',
  video_url: 'https://relay.example/motion.mp4',
  character_orientation: 'video',
  keep_original_sound: 'yes',
})

const omni = buildPikaVideoRequest('Wake up', {
  modelId: 'kling-o3',
  genMode: 'first-frame',
  duration: 12,
  sound: 'on',
  refImages: ['https://relay.example/omni.png'],
})
assert.equal(omni.path, '/v1/media/kling/kling-o3/image-to-video')
assert.deepEqual(omni.body, {
  prompt: 'Wake up',
  image_url: 'https://relay.example/omni.png',
  duration: 12,
  sound: 'on',
})
```

Also assert:

```js
assert.throws(
  () => buildPikaVideoRequest('x', { modelId: 'kling-v3', genMode: 'first-last-frame' }),
  /does not support first-last-frame/,
)
assert.throws(
  () => buildPikaVideoRequest('x', { modelId: 'kling-o3', genMode: 'text-to-video' }),
  /only supports first-frame/,
)
assert.throws(
  () => buildPikaVideoRequest('x', { modelId: 'kling-v3', genMode: 'first-frame', refImages: [] }),
  /requires one reference image/,
)
```

The request stub must then verify:

```js
const submit = await provider.generateVideo('Blink', {
  modelId: 'kling-v3',
  genMode: 'first-frame',
  refImages: ['https://relay.example/start.png'],
})
assert.deepEqual(submit, { done: false, taskId: 'job-1' })
assert.equal(requests[0].headers['X-API-Key'], 'test-key')

assert.deepEqual(await provider.checkStatus('queued-job'), {
  done: false,
  taskId: 'queued-job',
})
await assert.rejects(() => provider.checkStatus('failed-job'), /render rejected/)

const complete = await provider.checkStatus('complete-job')
assert.match(complete.filePath, /^assets\/pika_video_\d+\.mp4$/)
assert.equal(writes.length, 1)
```

Add the package script:

```json
"test:pika-provider": "node scripts/verify-pika-provider.mjs"
```

- [ ] **Step 2: Run the verification and confirm RED**

Run: `npm run test:pika-provider`

Expected: FAIL because `src/providers/pika.ts` does not exist.

- [ ] **Step 3: Implement the minimal provider**

Create `src/providers/pika.ts` with these public definitions:

```ts
const PIKA_API_BASE = 'https://api.dev.pika.art'

export interface PikaVideoRequest {
  path: string
  body: Record<string, unknown>
}

export function buildPikaVideoRequest(
  prompt: string,
  params: Record<string, unknown> = {},
): PikaVideoRequest

export class PikaVideoProvider implements VideoProvider {
  name = 'Pika'
  constructor(apiKey: string, app: App, outputDir: string)
  generateVideo(prompt: string, params?: Record<string, unknown>): Promise<GenerateVideoResult>
  checkStatus(taskId: string): Promise<GenerateVideoResult>
}

export async function testPikaConnection(apiKey: string): Promise<{
  ok: boolean
  message: string
}>
```

Route `mode: 'std'` to `standard`, preserve `pro` and `4k`, validate Pika's
documented enums, and include optional `negative_prompt` and `cfg_scale` only
when explicitly supplied. Submit with:

```ts
await requestUrl({
  url: `${PIKA_API_BASE}${request.path}`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': this.apiKey,
  },
  body: JSON.stringify(request.body),
  throw: false,
})
```

Parse `{ id, status }`, poll `GET /v1/media/jobs/{id}`, accept `queued` and
`running`, throw `error` on `failed`, and on `completed` prefer
`output.video.url`. If absent, fetch `GET /v1/media/jobs/{id}/content` and use
its `url`. Download through `requestUrl`, ensure `outputDir` exists, and write
`pika_video_${Date.now()}.mp4`.

`testPikaConnection` must call `GET https://api.dev.pika.art/v1/models` with
`X-API-Key`; return `Connected.` on 200 and `Invalid API key.` on 401/403.

- [ ] **Step 4: Run the Pika verification and confirm GREEN**

Run: `npm run test:pika-provider`

Expected: PASS with `Pika provider checks passed.`

- [ ] **Step 5: Commit the provider slice**

```bash
git add src/providers/pika.ts scripts/verify-pika-provider.mjs package.json
git commit -m "feat: add Pika video provider"
```

---

### Task 2: Settings, registry, and exact Kling catalogue mappings

**Files:**
- Modify: `scripts/verify-pika-provider.mjs`
- Modify: `src/settings.ts:88-121,161-194`
- Modify: `src/settings-migrations.ts:13`
- Modify: `src/providers/registry.ts:7-33,255-272`
- Modify: `src/models/kling.ts:55-63,139-168`

**Interfaces:**
- Consumes: `PikaVideoProvider`, `testPikaConnection`, `ProviderSpec`, and existing model-provider catalogue resolution.
- Produces: `providers.pika`, registry provider ID `pika`, Kling 3.0 and Kling 3.0 Omni Pika mappings.

- [ ] **Step 1: Extend the verification with failing wiring assertions**

Before touching production wiring, add source assertions:

```js
assert.match(settingsSource, /pika: string/)
assert.match(settingsSource, /pika: ''/)
assert.match(migrationsSource, /CURRENT_SETTINGS_SCHEMA_VERSION = 9/)
assert.match(registrySource, /id: 'pika'[\s\S]*makeVideo:/)
assert.match(registrySource, /testPikaConnection\(d\.pika \|\| ''\)/)
assert.match(
  modelSource,
  /id: 'kling-3\.0'[\s\S]*pika: \{ apiModelId: 'kling-v3', aggregated: true, modes: \['text-to-video', 'first-frame', 'motion-control'\] \}/,
)
assert.match(
  modelSource,
  /id: 'kling-3\.0-omni'[\s\S]*pika: \{ apiModelId: 'kling-o3', modes: \['first-frame'\] \}/,
)
assert.doesNotMatch(modelSource, /id: 'kling-o1'/)
```

Assert the Pika quality override contains Standard, Pro, and 4K, and the Omni
quality parameter is hidden for Pika.

- [ ] **Step 2: Run the verification and confirm RED**

Run: `npm run test:pika-provider`

Expected: FAIL at the first missing Pika settings/registry/catalog assertion.

- [ ] **Step 3: Add settings and migration support**

Add:

```ts
providers: {
  // existing fields...
  pika: string
}
```

and:

```ts
providers: {
  // existing defaults...
  pika: '',
}
```

Bump:

```ts
export const CURRENT_SETTINGS_SCHEMA_VERSION = 9
```

The centralized parser already iterates `Object.keys(defaults.providers)`, so no
provider-specific migration function is added.

- [ ] **Step 4: Register Pika**

Import `PikaVideoProvider` and `testPikaConnection`, then add:

```ts
{
  id: 'pika',
  name: 'Pika',
  docUrl: 'https://dev.pika.art/models',
  fields: [{ key: 'pika', label: 'API key', placeholder: 'pk_...', type: 'password' }],
  defaultRefDelivery: { image: 'relay', video: 'relay' },
  isConfigured: (s) => !!s.providers.pika,
  makeVideo: ({ settings, app, outputDir }) =>
    new PikaVideoProvider(settings.providers.pika, app, outputDir),
  testConnection: (d) => testPikaConnection(d.pika || ''),
},
```

- [ ] **Step 5: Add exact catalogue mappings and parameter overrides**

For Kling 3.0:

```ts
pika: {
  apiModelId: 'kling-v3',
  aggregated: true,
  modes: ['text-to-video', 'first-frame', 'motion-control'],
},
```

Add this override to the Kling 3.0 `mode` parameter:

```ts
providerOverrides: {
  pika: {
    options: [
      { label: 'Standard', value: 'std' },
      { label: 'Pro', value: 'pro' },
      { label: '4K', value: '4k' },
    ],
  },
},
```

For Kling 3.0 Omni:

```ts
pika: { apiModelId: 'kling-o3', modes: ['first-frame'] },
```

Add `providerOverrides: { pika: { hidden: true } }` to Omni's `mode` parameter
because the Pika O3 endpoint has no quality selector. Also hide Omni
`multi_shot` for Pika because Pika O3 image-to-video rejects that field.

- [ ] **Step 6: Run focused and catalogue verification**

Run:

```bash
npm run test:pika-provider
npm run check:catalog
npm run audit:catalog
```

Expected: all three commands pass with no catalogue errors.

- [ ] **Step 7: Commit the wiring slice**

```bash
git add scripts/verify-pika-provider.mjs src/settings.ts src/settings-migrations.ts src/providers/registry.ts src/models/kling.ts
git commit -m "feat: connect Pika to Kling models"
```

---

### Task 3: Documentation, coupled skill update, and full verification

**Files:**
- Modify: `docs/model-provider-rules.md`
- Modify: `scripts/verify-pika-provider.mjs`
- External paired repository: `nextbound/bragi-canvas-skill`

**Interfaces:**
- Consumes: completed Pika provider and catalogue mappings.
- Produces: durable provider behavior documentation, paired skill reference update, and PR-ready verification evidence.

- [ ] **Step 1: Add a failing documentation assertion**

Add:

```js
assert.match(
  modelRulesSource,
  /## Pika Kling[\s\S]*Kling 3\\.0[\\s\\S]*Kling 3\\.0 Omni/,
)
```

- [ ] **Step 2: Run the verification and confirm RED**

Run: `npm run test:pika-provider`

Expected: FAIL because `docs/model-provider-rules.md` has no Pika Kling section.

- [ ] **Step 3: Document the provider contract**

Add `## Pika Kling` to `docs/model-provider-rules.md` with:

- base URL and `X-API-Key` authentication;
- the exact Kling 3.0 and O3 route/mode mapping;
- Standard/Pro/4K route selection;
- Bragi Relay requirements;
- shared jobs polling and content fallback;
- explicit exclusion of Kling O1 and Kling 2.6.

- [ ] **Step 4: Update the paired skill repository**

Create branch `feat/pika-provider` in `nextbound/bragi-canvas-skill`. Update its
model/provider reference so it lists Pika for Kling 3.0 and Kling 3.0 Omni with
the same effective modes and excludes Kling O1. Commit, push, and create a PR
that cross-links the plugin PR. If repository access is unavailable, record the
exact missing permission in the plugin PR instead of claiming completion.

- [ ] **Step 5: Run the full local verification matrix**

Run:

```bash
npm run test:pika-provider
npm run test:kling-omni
npm run check:catalog
npm run audit:catalog
npm run lint:obsidian
npm run build
git diff --check
git status --short --branch
```

Expected: every command exits 0, lint/build output has no errors, diff check is
silent, and only intended files are modified.

- [ ] **Step 6: Run the non-generating live Pika check**

Call `GET https://api.dev.pika.art/v1/models` with the supplied `X-API-Key`.
Expected: HTTP 200. Do not submit a valid media generation request.

- [ ] **Step 7: Commit documentation**

```bash
git add docs/model-provider-rules.md scripts/verify-pika-provider.mjs
git commit -m "docs: document Pika Kling mappings"
```

- [ ] **Step 8: Push and open the plugin PR**

Push `feat/pika-provider` to the user's fork and open a ready PR against
`nextbound/bragi-canvas:main`. Include:

- exact model/mode mappings;
- local verification commands and results;
- non-generating API authentication result;
- explicit statement that no API key or live output was committed;
- the paired skill PR link or precise access blocker.
