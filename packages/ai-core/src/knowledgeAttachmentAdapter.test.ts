import { describe, expect, it } from 'vitest'
import { KnowledgeAttachmentAdapter } from './knowledgeAttachmentAdapter'

function minimalPdf(text: string): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length + 34} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(body).length)
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = new TextEncoder().encode(body).length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new TextEncoder().encode(body)
}

describe('KnowledgeAttachmentAdapter', () => {
  it('extracts text from a PDF attachment', async () => {
    const adapter = new KnowledgeAttachmentAdapter()
    const file = new File([minimalPdf('Hello PDF')], 'sample.pdf', { type: 'application/pdf' })
    const pending = await adapter.add({ file })
    const complete = await adapter.send(pending)

    expect(complete.status).toEqual({ type: 'complete' })
    expect(complete.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Hello PDF') }),
    ]))
  })
})
