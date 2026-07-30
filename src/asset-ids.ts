import type { Canvas, CanvasNode } from './types/canvas-internal'

export type SeedanceAssetProviderId = 'tokenrouter' | 'byteplus' | 'bytedance'

export const SEEDANCE_ASSET_PROVIDER_LABELS: Record<SeedanceAssetProviderId, string> = {
	tokenrouter: 'TokenRouter',
	byteplus: 'BytePlus',
	bytedance: 'Volcengine',
}

const ASSET_ID_IMAGE_EXTS = /\.(png|jpg|jpeg|webp|bmp|tiff?|gif|heic|heif)$/i
const ASSET_ID_AUDIO_EXTS = /\.(mp3|wav|flac|m4a|ogg|aac|opus)$/i

type AssetNodeData = {
	bragiAssetId?: string
	bragiAssetIds?: Record<string, string>
}

export type SeedanceAssetMediaKind = 'image' | 'audio'

export function getSeedanceAssetMediaKind(filePath: string): SeedanceAssetMediaKind | null {
	if (ASSET_ID_IMAGE_EXTS.test(filePath)) return 'image'
	if (ASSET_ID_AUDIO_EXTS.test(filePath)) return 'audio'
	return null
}

export function findFileNodeByPath(canvas: Canvas, filePath: string): CanvasNode | null {
	const nodes = canvas.nodes instanceof Map
		? Array.from(canvas.nodes.values())
		: canvas.nodes as unknown as CanvasNode[]
	for (const node of nodes) {
		const data = node.getData()
		if (data.type === 'file' && data.file === filePath) return node
	}
	return null
}

export function getNodeAssetIdMap(node: CanvasNode): Record<string, string> {
	const data = node.getData() as AssetNodeData
	const ids = { ...(data.bragiAssetIds || {}) }
	if (data.bragiAssetId && !ids.legacy) ids.legacy = data.bragiAssetId
	return ids
}

export function getNodeAssetId(node: CanvasNode, provider: string): string {
	const data = node.getData() as AssetNodeData
	const scoped = data.bragiAssetIds?.[provider]
	if (scoped) return scoped
	if ((provider === 'bytedance' || provider === 'byteplus') && data.bragiAssetId) return data.bragiAssetId
	return ''
}

export function setNodeAssetId(node: CanvasNode, provider: SeedanceAssetProviderId, assetId: string): void {
	const data = node.getData() as AssetNodeData
	const hadScopedId = !!data.bragiAssetIds?.[provider]
	const ids = { ...(data.bragiAssetIds || {}) }
	if (assetId) ids[provider] = assetId
	else delete ids[provider]

	const next: AssetNodeData = { ...data }
	if (Object.keys(ids).length > 0) next.bragiAssetIds = ids
	else delete next.bragiAssetIds
	if (!assetId && !hadScopedId && (provider === 'bytedance' || provider === 'byteplus')) {
		delete next.bragiAssetId
	}
	node.setData(next)
}

export function getAssetIdsForFiles(
	canvas: Canvas,
	filePaths: string[],
	provider?: string,
): Record<string, string> {
	const result: Record<string, string> = {}
	for (const filePath of filePaths) {
		const fileNode = findFileNodeByPath(canvas, filePath)
		if (!fileNode || !provider) continue
		const assetId = getNodeAssetId(fileNode, provider)
		if (assetId) result[filePath] = assetId
	}
	return result
}
