import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian'

export const DEFAULT_DENOISE_SERVICE_URL = 'http://127.0.0.1:17776'
export const NLM_35_STRENGTH = 0.35

type Requester = (request: RequestUrlParam | string) => Promise<RequestUrlResponse>

interface NlmDenoisePayload {
	image: string
	mimeType: string
	width: number
	height: number
	algorithm: string
}

export interface NlmDenoiseResult {
	bytes: ArrayBuffer
	mimeType: string
	width: number
	height: number
}

export function resolveDenoiseEndpoint(serviceUrl: string): string {
	const base = serviceUrl.trim().replace(/\/+$/, '') || DEFAULT_DENOISE_SERVICE_URL
	return base.endsWith('/v1/denoise') ? base : `${base}/v1/denoise`
}

export async function requestNlm35Denoise(
	dataUri: string,
	serviceUrl: string,
	requester: Requester = requestUrl,
): Promise<NlmDenoiseResult> {
	const endpoint = resolveDenoiseEndpoint(serviceUrl)
	let response: RequestUrlResponse
	try {
		response = await requester({
			url: endpoint,
			method: 'POST',
			contentType: 'application/json',
			body: JSON.stringify({ image: dataUri, strength: NLM_35_STRENGTH }),
			throw: false,
		})
	} catch (error: unknown) {
		throw new Error(`NLM 35 service is unavailable at ${endpoint}: ${errorMessage(error)}`)
	}

	const payload = response.json as unknown
	if (response.status < 200 || response.status >= 300) {
		throw new Error(readServiceError(payload) || `NLM 35 service returned HTTP ${response.status}`)
	}
	if (!isNlmDenoisePayload(payload)) {
		throw new Error('NLM 35 service returned an invalid response')
	}
	if (payload.algorithm !== 'nlm-35') {
		throw new Error(`NLM 35 service returned unexpected algorithm "${payload.algorithm}"`)
	}

	return {
		bytes: decodeImageDataUri(payload.image, payload.mimeType),
		mimeType: payload.mimeType,
		width: payload.width,
		height: payload.height,
	}
}

function isNlmDenoisePayload(value: unknown): value is NlmDenoisePayload {
	if (!value || typeof value !== 'object') return false
	const payload = value as Record<string, unknown>
	return typeof payload.image === 'string'
		&& typeof payload.mimeType === 'string'
		&& typeof payload.width === 'number'
		&& Number.isInteger(payload.width)
		&& payload.width > 0
		&& typeof payload.height === 'number'
		&& Number.isInteger(payload.height)
		&& payload.height > 0
		&& typeof payload.algorithm === 'string'
}

function decodeImageDataUri(dataUri: string, expectedMimeType: string): ArrayBuffer {
	const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUri)
	if (!match || match[1] !== expectedMimeType) {
		throw new Error('NLM 35 service returned invalid image data')
	}
	try {
		const binary = atob(match[2].replace(/\s/g, ''))
		const bytes = new Uint8Array(binary.length)
		for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
		return bytes.buffer
	} catch {
		throw new Error('NLM 35 service returned malformed base64 image data')
	}
}

function readServiceError(value: unknown): string {
	if (!value || typeof value !== 'object') return ''
	const error = (value as Record<string, unknown>).error
	return typeof error === 'string' ? error : ''
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
