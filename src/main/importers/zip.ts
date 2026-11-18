import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

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

/**
 * Grava um ZIP simples (sem ZIP64, nomes em UTF-8), comprimindo com deflate. Serve para os pacotes .apkg exportados
 * e é lido de volta pelo `listZip`/`readZipEntry` acima.
 */
export function writeZip(files: { name: string; data: Buffer }[], date = new Date()): Buffer {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const compressed = deflateRawSync(file.data)
    const crc = crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    local.writeUInt16LE(20, 4) // versão necessária
    local.writeUInt16LE(0x800, 6) // nome em UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    central.writeUInt16LE(20, 4) // feito por
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD_SIGNATURE, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}
