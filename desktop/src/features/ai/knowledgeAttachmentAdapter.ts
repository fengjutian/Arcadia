import {
  generateId,
  type AttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
} from '@assistant-ui/react'

const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_TEXT_CHARS = 100_000

const escapeName = (name: string) => name
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map(item => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
    if (text) pages.push(`--- 第 ${pageNumber} 页 ---\n${text}`)
    if (pages.join('\n\n').length >= MAX_TEXT_CHARS) break
  }
  return pages.join('\n\n')
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser')
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value
}

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return extractPdf(file)
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) {
    return extractDocx(file)
  }
  return file.text()
}

export class KnowledgeAttachmentAdapter implements AttachmentAdapter {
  public accept = [
    'text/plain', 'text/html', 'text/markdown', 'text/csv', 'text/xml',
    'text/json', 'application/json', 'text/css', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.md', '.txt', '.csv', '.json', '.xml', '.html', '.css', '.pdf', '.docx',
  ].join(',')

  public async add({ file }: { file: File }): Promise<PendingAttachment> {
    if (file.size > MAX_FILE_BYTES) throw new Error(`附件不能超过 ${MAX_FILE_BYTES / 1024 / 1024} MB`)
    return {
      id: generateId(),
      type: 'document',
      name: file.name,
      contentType: file.type || 'application/octet-stream',
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    }
  }

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const text = (await extractText(attachment.file)).trim().slice(0, MAX_TEXT_CHARS)
    if (!text) throw new Error(`无法从 ${attachment.name} 中提取文本`)
    return {
      ...attachment,
      status: { type: 'complete' },
      content: [{
        type: 'text',
        text: `<attachment name="${escapeName(attachment.name)}">\n${text}\n</attachment>`,
      }],
    }
  }

  public async remove() {
    // Files are read locally and never uploaded, so there is no remote cleanup.
  }
}
