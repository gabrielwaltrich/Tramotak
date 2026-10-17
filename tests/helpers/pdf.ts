/**
 * PDF mínimo e válido, com uma página por item e as linhas de texto de cada uma (Helvetica, WinAnsi). Serve para
 * testar a leitura do texto e o leitor sem guardar arquivos binários no repositório.
 */
export function makePdf(pages: string[][]): Buffer {
  const objects: string[] = []
  const add = (body: string) => objects.push(body)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const font = objects.length
  const pagesId = font + pages.length * 2 + 1
  const pageIds: number[] = []
  for (const lines of pages) {
    const escape = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`)
    const stream = `BT /F1 14 Tf 72 740 Td 18 TL ${lines.map((l) => `(${escape(l)}) Tj T*`).join(' ')} ET`
    add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    const content = objects.length
    add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`)
    pageIds.push(objects.length)
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  const catalog = objects.length
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
