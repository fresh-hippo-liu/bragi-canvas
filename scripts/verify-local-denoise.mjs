import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const denoiseSource = readFileSync('src/denoise.ts', 'utf8')
const mainSource = readFileSync('src/main.ts', 'utf8')
const modalSource = readFileSync('src/ui/denoise-choice-modal.ts', 'utf8')
const settingsSource = readFileSync('src/settings.ts', 'utf8')
const migrationsSource = readFileSync('src/settings-migrations.ts', 'utf8')

assert.match(denoiseSource, /export const NLM_35_STRENGTH = 0\.35/, 'NLM strength must stay at the selected 35% blend.')
assert.match(denoiseSource, /body: JSON\.stringify\(\{ image: dataUri, strength: NLM_35_STRENGTH \}\)/, 'The client must send the image and NLM 35 strength.')
assert.match(modalSource, /private method: DenoiseMethod = 'nlm35'/, 'NLM 35 must be the default denoise choice.')
assert.match(modalSource, /const nlmLabel = 'NLM 35 - local CPU'[\s\S]*addOption\('nlm35', nlmLabel\)/, 'The modal must expose NLM 35.')
assert.doesNotMatch(modalSource, /obsidianmd\/ui\/sentence-case/, 'The modal must not disable Obsidian sentence-case lint.')
assert.match(modalSource, /addOption\([\s\S]*'flux'[\s\S]*FLUX\.2 Klein 9B/, 'The modal must retain the FLUX choice.')
assert.match(modalSource, /fluxOption\.disabled = !this\.options\.fluxAvailable/, 'Unavailable FLUX must be disabled in the dropdown.')
assert.match(mainSource, /new DenoiseChoiceModal\(this\.app, \{[\s\S]*fluxAvailable: Boolean\(fluxContext\)[\s\S]*handleImageDenoise\(node, canvas, method\)/, 'The toolbar action must open the denoise choice modal.')
assert.match(mainSource, /async handleImageDenoise\(node: CanvasNode, canvas: Canvas, method: DenoiseMethod = 'nlm35'\)/, 'The dispatcher must default to NLM 35.')
assert.match(mainSource, /createPlaceholderNode\(canvas, 'NLM 35'/, 'NLM must use the normal generation placeholder.')
assert.match(mainSource, /requestNlm35Denoise\(dataUri, this\.settings\.denoiseServiceUrl\)/, 'NLM must use the configured service endpoint.')
assert.match(mainSource, /writeNlm35Result\(filePath, result\.bytes\)[\s\S]*replacePlaceholderWithFile\(canvas, placeholder, outputPath, node\)/, 'NLM output must replace the placeholder with a file node.')
assert.match(settingsSource, /denoiseServiceUrl: string/, 'Settings must include the denoise service URL.')
assert.match(settingsSource, /denoiseServiceUrl: DEFAULT_DENOISE_SERVICE_URL/, 'Settings must default to the localhost service.')
assert.match(migrationsSource, /readOptionalString\(raw, 'denoiseServiceUrl'/, 'Settings migration must retain a configured service URL.')

const bundle = await build({
	entryPoints: ['src/denoise.ts'],
	bundle: true,
	write: false,
	platform: 'node',
	format: 'esm',
	plugins: [{
		name: 'obsidian-stub',
		setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }))
			builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const requestUrl = async () => { throw new Error("not mocked") }' }))
		},
	}],
})

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
const denoise = await import(moduleUrl)
let capturedRequest
const result = await denoise.requestNlm35Denoise(
	'data:image/png;base64,AA==',
	'http://127.0.0.1:17776/',
	async request => {
		capturedRequest = request
		return {
			status: 200,
			headers: {},
			arrayBuffer: new ArrayBuffer(0),
			text: '',
			json: {
				algorithm: 'nlm-35',
				mimeType: 'image/png',
				width: 24,
				height: 16,
				image: 'data:image/png;base64,AQID',
			},
		}
	},
)

assert.equal(capturedRequest.url, 'http://127.0.0.1:17776/v1/denoise')
assert.equal(capturedRequest.method, 'POST')
assert.deepEqual(JSON.parse(capturedRequest.body), { image: 'data:image/png;base64,AA==', strength: 0.35 })
assert.deepEqual([...new Uint8Array(result.bytes)], [1, 2, 3])
assert.equal(result.width, 24)
assert.equal(result.height, 16)

await assert.rejects(
	denoise.requestNlm35Denoise('data:image/png;base64,AA==', '', async () => ({
		status: 503,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		text: '',
		json: { error: 'service busy' },
	})),
	/service busy/,
)

console.log('Local NLM denoise checks passed.')
