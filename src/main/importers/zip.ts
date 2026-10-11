import { inflateRawSync } from 'node:zlib'

/** Leitor mínimo de ZIP (sem ZIP64): o suficiente para pacotes .apkg do Anki. */

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

function findEndOfCentralDirectory(buf: Buffer): number {
  // O registro final tem 22 bytes + comentário de até 65535 bytes.
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new Error('Arquivo não é um ZIP válido')
}

export function listZip(buf: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  if (offset === 0xffffffff) throw new Error('ZIP64 não é suportado')

  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error('ZIP corrompido')
    const flags = buf.readUInt16LE(offset + 8)
    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)
    const nameBytes = buf.subarray(offset + 46, offset + 46 + nameLength)
    entries.push({
      name: nameBytes.toString(flags & 0x800 ? 'utf8' : 'latin1'),
      method: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      size: buf.readUInt32LE(offset + 24),
      localOffset: buf.readUInt32LE(offset + 42)
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localOffset
  if (buf.readUInt32LE(at) !== LOCAL_SIGNATURE) throw new Error('ZIP corrompido')
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28)
  const data = buf.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(data)
  if (entry.method === 8) return inflateRawSync(data)
  throw new Error(`Compressão ZIP não suportada (método ${entry.method})`)
}
