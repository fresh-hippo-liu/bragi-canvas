import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const tempDir = await mkdtemp(path.join(tmpdir(), 'bragi-audio-asset-id-'))
const outfile = path.join(tempDir, 'asset-ids.mjs')

try {
	await esbuild.build({
		entryPoints: ['src/asset-ids.ts'],
		bundle: true,
		platform: 'node',
		format: 'esm',
		outfile,
		logLevel: 'silent',
	})

	const assetIds = await import(pathToFileURL(outfile).href)
	assert.equal(assetIds.getSeedanceAssetMediaKind('refs/face.png'), 'image')
	assert.equal(assetIds.getSeedanceAssetMediaKind('refs/voice.mp3'), 'audio')
	assert.equal(assetIds.getSeedanceAssetMediaKind('refs/voice.m4a'), 'audio')
	assert.equal(assetIds.getSeedanceAssetMediaKind('refs/clip.mp4'), null)

	let nodeData = { type: 'file', file: 'refs/voice.mp3' }
	const audioNode = {
		getData: () => nodeData,
		setData: next => { nodeData = next },
	}
	const canvas = { nodes: new Map([['audio-node', audioNode]]) }

	assetIds.setNodeAssetId(audioNode, 'bytedance', 'asset-audio-1')
	assert.deepEqual(nodeData.bragiAssetIds, { bytedance: 'asset-audio-1' })
	assert.equal(assetIds.getNodeAssetId(audioNode, 'bytedance'), 'asset-audio-1')
	assert.deepEqual(
		assetIds.getAssetIdsForFiles(canvas, ['refs/voice.mp3'], 'bytedance'),
		{ 'refs/voice.mp3': 'asset-audio-1' },
	)

	assetIds.setNodeAssetId(audioNode, 'bytedance', '')
	assert.equal(nodeData.bragiAssetIds, undefined)

	const mainSource = await readFile('src/main.ts', 'utf8')
	const mcpSource = await readFile('src/mcp-tool-registry.ts', 'utf8')

	assert.match(
		mainSource,
		/if \(!getSeedanceAssetMediaKind\(filePath\)\) return/,
		'canvas context menu must accept every supported Seedance asset media kind',
	)
	assert.match(
		mainSource,
		/const audioAssetIdMap = supportsSeedanceAssetRefs[\s\S]*getAssetIdsForFiles\(canvas, uniqueAudios, activeProvider\)/,
		'video generation must collect provider-scoped asset IDs from upstream audio nodes',
	)

	const audioFlowStart = mainSource.indexOf('// Upload reference audios')
	const audioFlowEnd = mainSource.indexOf('// Prepare reference videos', audioFlowStart)
	assert.notEqual(audioFlowStart, -1)
	assert.notEqual(audioFlowEnd, -1)
	const audioFlow = mainSource.slice(audioFlowStart, audioFlowEnd)
	assert.match(
		audioFlow,
		/else if \(audioAssetIdMap\[audioPath\]\) \{[\s\S]*refAudios\.push\(`asset:\/\/\$\{audioAssetIdMap\[audioPath\]\}`\)/,
		'manually bound audio asset IDs must be passed to Seedance as asset:// references',
	)
	assert.ok(
		audioFlow.indexOf('else if (tokenRouterModelArkCreds)') < audioFlow.indexOf('else if (audioAssetIdMap[audioPath])'),
		'configured TokenRouter ModelArk assets must still validate the cached ID before reuse',
	)
	assert.match(
		mcpSource,
		/Bind a provider-specific Seedance Asset ID to an image or audio file node/,
		'MCP set_asset_id description must document audio node support',
	)
	assert.match(
		mcpSource,
		/!getSeedanceAssetMediaKind\(d\.file \|\| ''\)/,
		'MCP set_asset_id must use the same image/audio validation as the context menu',
	)

	console.log('Audio Asset ID checks passed.')
} finally {
	await rm(tempDir, { recursive: true, force: true })
}
