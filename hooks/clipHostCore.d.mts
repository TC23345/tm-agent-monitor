export const HOST_NAME: string
export const EXTENSION_ID: string
export const MAX_FRAME_BYTES: number
export const MAX_REPLY_BYTES: number
export function extensionIdFromKey(keyBase64: string): string
export function originFor(extensionId: string): string
export function hostManifest(input: { hostPath: string; extensionId: string; description?: string }): { name: string; description: string; path: string; type: 'stdio'; allowed_origins: string[] }
export function registryKeys(): string[]
export function inspectHostManifest(manifest: unknown, me: { hostPath: string; extensionId: string }): { installed: boolean; needsRepair: boolean }
export function encodeFrame(message: unknown): Buffer
export function decodeFrames(buffer: Buffer): { frames: unknown[]; rest: Buffer; error?: undefined } | { error: string; frames?: undefined; rest?: undefined }
export type ExtensionMessage =
  | { type: 'hello' }
  | { type: 'source'; url: string; title?: string }
  | { type: 'clips'; limit: number }
  | { type: 'clip'; id: string; req: number }
  | { type: 'save'; text: string; favorite: boolean; req?: number }
  | { type: 'snippets' }
export function validateExtensionMessage(value: unknown): ExtensionMessage | null
