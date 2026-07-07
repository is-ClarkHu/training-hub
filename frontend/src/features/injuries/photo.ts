// Client-side photo compression (§6A Phase 4). Downscale to a max edge and
// re-encode as JPEG so injury photos stay small (kept local in IndexedDB, never
// synced). Medical imaging is intentionally unsupported — photos only.
const MAX_EDGE = 1600
const QUALITY = 0.8

/** Read + downscale an image File into a compressed JPEG data URL. */
export async function compressImage(file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file)
  const img = await loadImage(dataUrl)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl // fallback: original
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', QUALITY)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}
