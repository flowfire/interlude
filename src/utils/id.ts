const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 生成短 id，带语义前缀，便于在调试面板里肉眼区分 */
export function makeId(prefix: string): string {
  let out = ''
  const cryptoObj = globalThis.crypto
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(8)
    cryptoObj.getRandomValues(bytes)
    for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  } else {
    for (let i = 0; i < 8; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return `${prefix}_${out}`
}
