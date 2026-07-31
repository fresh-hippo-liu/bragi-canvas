import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const tempDir = await mkdtemp(join(tmpdir(), 'bragi-pika-provider-'))
const bundlePath = join(tempDir, 'pika-provider.mjs')

try {
	await build({
		entryPoints: ['src/providers/pika.ts'],
		bundle: true,
		platform: 'node',
		format: 'esm',
		outfile: bundlePath,
		logLevel: 'silent',
		plugins: [{
			name: 'mock-obsidian',
			setup(buildApi) {
				buildApi.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock-obsidian' }))
				buildApi.onLoad({ filter: /.*/, namespace: 'mock-obsidian' }, () => ({
					contents: `
						export async function requestUrl(options) {
							return process.__bragiPikaRequestHandler(options)
						}
					`,
					loader: 'js',
				}))
			},
		}],
	})

	const {
		buildPikaVideoRequest,
		PikaVideoProvider,
		testPikaConnection,
	} = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)

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
	assert.deepEqual(proImage.body, {
		prompt: 'Blink and smile',
		image: 'https://relay.example/start.png',
		duration: '10',
		aspect_ratio: '9:16',
	})

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
	assert.throws(
		() => buildPikaVideoRequest('x', {
			modelId: 'kling-v3',
			genMode: 'motion-control',
			refImages: ['https://relay.example/character.png'],
			refVideos: [],
		}),
		/requires one reference image and one reference video/,
	)
	assert.throws(
		() => buildPikaVideoRequest('x', {
			modelId: 'kling-o3',
			genMode: 'first-frame',
			duration: 16,
			refImages: ['https://relay.example/start.png'],
		}),
		/duration must be a whole number from 3 to 15/,
	)

	const requests = []
	const writes = []
	const app = {
		vault: {
			adapter: {
				exists: async () => true,
				mkdir: async () => {},
				writeBinary: async (path, data) => writes.push({ path, data }),
			},
		},
	}
	const provider = new PikaVideoProvider('test-key', app, 'assets')

	process.__bragiPikaRequestHandler = async (request) => {
		requests.push(request)
		return { status: 200, json: { id: 'job-1', status: 'queued' } }
	}
	const submit = await provider.generateVideo('Blink', {
		modelId: 'kling-v3',
		genMode: 'first-frame',
		refImages: ['https://relay.example/start.png'],
	})
	assert.deepEqual(submit, { done: false, taskId: 'job-1' })
	assert.equal(requests[0].url, 'https://api.dev.pika.art/v1/media/kling/kling-v3/standard/image-to-video')
	assert.equal(requests[0].headers['X-API-Key'], 'test-key')

	process.__bragiPikaRequestHandler = async (request) => {
		requests.push(request)
		if (request.url.endsWith('/jobs/queued-job')) {
			return { status: 200, json: { id: 'queued-job', status: 'running' } }
		}
		throw new Error(`Unexpected request: ${request.url}`)
	}
	assert.deepEqual(await provider.checkStatus('queued-job'), {
		done: false,
		taskId: 'queued-job',
	})

	process.__bragiPikaRequestHandler = async (request) => {
		requests.push(request)
		return { status: 200, json: { id: 'failed-job', status: 'failed', error: 'render rejected' } }
	}
	await assert.rejects(() => provider.checkStatus('failed-job'), /render rejected/)

	process.__bragiPikaRequestHandler = async (request) => {
		requests.push(request)
		if (request.url.endsWith('/jobs/complete-job')) {
			return {
				status: 200,
				json: {
					id: 'complete-job',
					status: 'completed',
					output: {
						media_type: 'video',
						video: { url: 'https://cdn.example/result.mp4', content_type: 'video/mp4' },
					},
				},
			}
		}
		if (request.url === 'https://cdn.example/result.mp4') {
			return { status: 200, arrayBuffer: new Uint8Array([1, 2, 3]).buffer }
		}
		throw new Error(`Unexpected request: ${request.url}`)
	}
	const complete = await provider.checkStatus('complete-job')
	assert.match(complete.filePath, /^assets\/pika_video_\d+\.mp4$/)
	assert.equal(writes.length, 1)
	assert.deepEqual([...new Uint8Array(writes[0].data)], [1, 2, 3])

	process.__bragiPikaRequestHandler = async (request) => {
		requests.push(request)
		if (request.url.endsWith('/jobs/content-job')) {
			return { status: 200, json: { id: 'content-job', status: 'completed' } }
		}
		if (request.url.endsWith('/jobs/content-job/content')) {
			return { status: 200, json: { url: 'https://cdn.example/content-result.mp4' } }
		}
		if (request.url === 'https://cdn.example/content-result.mp4') {
			return { status: 200, arrayBuffer: new Uint8Array([4, 5, 6]).buffer }
		}
		throw new Error(`Unexpected request: ${request.url}`)
	}
	const contentFallback = await provider.checkStatus('content-job')
	assert.match(contentFallback.filePath, /^assets\/pika_video_\d+\.mp4$/)
	assert.equal(writes.length, 2)

	process.__bragiPikaRequestHandler = async () => ({ status: 200, json: { object: 'list', data: [] } })
	assert.deepEqual(await testPikaConnection('valid-key'), { ok: true, message: 'Connected.' })
	process.__bragiPikaRequestHandler = async () => ({ status: 401, json: { message: 'Unauthorized' } })
	assert.deepEqual(await testPikaConnection('bad-key'), { ok: false, message: 'Invalid API key.' })

	const [settingsSource, migrationsSource, registrySource, modelSource, modelRulesSource] = await Promise.all([
		readFile('src/settings.ts', 'utf8'),
		readFile('src/settings-migrations.ts', 'utf8'),
		readFile('src/providers/registry.ts', 'utf8'),
		readFile('src/models/kling.ts', 'utf8'),
		readFile('docs/model-provider-rules.md', 'utf8'),
	])
	assert.match(settingsSource, /pika: string/, 'Settings type must include providers.pika.')
	assert.match(settingsSource, /pika: ''/, 'Default settings must include an empty Pika key.')
	assert.match(
		migrationsSource,
		/CURRENT_SETTINGS_SCHEMA_VERSION = 10/,
		'Adding a provider credential must advance the settings schema version.',
	)
	assert.match(
		registrySource,
		/import \{ PikaVideoProvider, testPikaConnection \} from '\.\/pika'/,
		'Provider registry must import the Pika implementation and connection test.',
	)
	assert.match(
		registrySource,
		/id: 'pika'[\s\S]*?name: 'Pika'[\s\S]*?defaultRefDelivery: \{ image: 'relay', video: 'relay' \}[\s\S]*?makeVideo:/,
		'Provider registry must expose Pika as a relay-backed video provider.',
	)
	assert.match(
		registrySource,
		/testConnection: \(d\) => testPikaConnection\(d\.pika \|\| ''\)/,
		'Provider registry must use the non-generating Pika connection test.',
	)
	assert.match(
		modelSource,
		/id: 'kling-3\.0'[\s\S]*?pika: \{[\s\S]*?apiModelId: 'kling-v3'[\s\S]*?aggregated: true[\s\S]*?modes: \['text-to-video', 'first-frame', 'motion-control'\][\s\S]*?\}/,
		'Kling 3.0 must map Pika to the exact supported modes.',
	)
	assert.match(
		modelSource,
		/id: 'mode'[\s\S]*?providerOverrides: \{[\s\S]*?pika: \{[\s\S]*?label: 'Standard', value: 'std'[\s\S]*?label: 'Pro', value: 'pro'[\s\S]*?label: '4K', value: '4k'/,
		'Kling 3.0 must expose Pika Standard, Pro, and 4K quality routes.',
	)
	assert.match(
		modelSource,
		/id: 'kling-3\.0-omni'[\s\S]*?pika: \{ apiModelId: 'kling-o3', modes: \['first-frame'\] \}/,
		'Kling 3.0 Omni must map Pika O3 to first-frame only.',
	)
	assert.match(
		modelSource,
		/id: 'mode'[\s\S]*?providerOverrides: \{ pika: \{ hidden: true \} \}/,
		'Kling 3.0 Omni must hide its unsupported quality selector for Pika.',
	)
	assert.match(
		modelSource,
		/id: 'multi_shot'[\s\S]*?providerOverrides: \{ pika: \{ hidden: true \} \}/,
		'Kling 3.0 Omni must hide its unsupported multi-shot selector for Pika.',
	)
	assert.doesNotMatch(modelSource, /id: 'kling-o1'/, 'This change must not add a mismatched Kling O1 model.')
	assert.match(
		modelRulesSource,
		/## Pika Kling[\s\S]*Kling 3\.0[\s\S]*Kling 3\.0 Omni/,
		'Provider rules must document the Pika Kling 3.0 and Kling 3.0 Omni mappings.',
	)

	console.log('Pika provider checks passed.')
} finally {
	delete process.__bragiPikaRequestHandler
	await rm(tempDir, { recursive: true, force: true })
}
