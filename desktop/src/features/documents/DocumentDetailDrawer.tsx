import { t } from '../../i18n'
import { Button, Descriptions, Drawer, Empty, Input, message, Popconfirm, Space, Tag, Tooltip, Typography } from '../../components/ui'
import { CopyOutlined, DeleteOutlined, ExportOutlined, InboxOutlined, LinkOutlined, PlusOutlined } from '../../components/ui/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useMemo, useState } from 'react'
import type { Document } from '../../types'
import { archiveDocument, deleteDocument, updateTags } from '../../api'

export function DocumentDetailDrawer({ document, onClose, onDeleted, onExported, onUpdated }: { document: Document|null; onClose:()=>void; onDeleted:(id:string)=>void; onExported?: (document: Document) => void; onUpdated?: (document: Document) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [tagsDraft, setTagsDraft] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [showFullDocument, setShowFullDocument] = useState(false)
  const autoTags = document?.autoTags ?? []
  useEffect(() => { setTagsDraft(document?.tags ?? []); setTagInput(''); setShowFullDocument(false) }, [document?.id, document?.tags])
  const markdownPreview = useMemo(() => {
    const markdown = document?.markdown ?? ''
    if (showFullDocument || markdown.length <= 18_000) return markdown
    const boundary = markdown.lastIndexOf('\n', 18_000)
    return markdown.slice(0, boundary > 12_000 ? boundary : 18_000)
  }, [document?.markdown, showFullDocument])
  const isPreview = Boolean(document?.markdown && markdownPreview.length < document.markdown.length)
  async function remove(){if(!document)return;try{await deleteDocument(document.id);messageApi.success(t("\u6587\u6863\u5DF2\u5220\u9664"));onDeleted(document.id);onClose()}catch{messageApi.error(t("\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"))}}
  async function archive(){if(!document)return;try{await archiveDocument(document.id);messageApi.success(t("\u5DF2\u5F52\u6863"));onClose()}catch{messageApi.error(t("\u5F52\u6863\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"))}}
  async function persistTags(next: string[]){
    if(!document)return
    try{await updateTags(document.id, next);setTagsDraft(next);onUpdated?.({...document, tags: next});messageApi.success(t("\u6807\u7B7E\u5DF2\u66F4\u65B0"))}catch{messageApi.error(t("\u6807\u7B7E\u66F4\u65B0\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"))}
  }
  function addTag(){
    const value = tagInput.trim()
    if(!value||tagsDraft.includes(value)){setTagInput('');return}
    void persistTags([...tagsDraft, value])
    setTagInput('')
  }
  function removeTag(tag: string){void persistTags(tagsDraft.filter(item => item !== tag))}
  async function copyMarkdown(text: string){try{await navigator.clipboard.writeText(text);messageApi.success(t("Markdown \u5DF2\u590D\u5236"))}catch{messageApi.error(t("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u6743\u9650"))}}
  async function copyLink(url: string){try{await navigator.clipboard.writeText(url);messageApi.success(t("\u94FE\u63A5\u5DF2\u590D\u5236"))}catch{messageApi.error(t("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u6743\u9650"))}}
  const actions = document && <Space size={4} className="document-reader__actions">
    <Tooltip title={t("\u6253\u5F00\u539F\u6587")}><Button type="text"aria-label={t("\u6253\u5F00\u539F\u6587")}icon={<LinkOutlined/>}href={document.url}target="_blank"/></Tooltip>
    <Tooltip title={t("\u590D\u5236\u94FE\u63A5")}><Button type="text"aria-label={t("\u590D\u5236\u94FE\u63A5")}icon={<CopyOutlined/>}onClick={()=>void copyLink(document.url)}/></Tooltip>
    <Popconfirm title={t("\u5F52\u6863\u8FD9\u7BC7\u6587\u6863\uFF1F")}description={t("\u5F52\u6863\u540E\u9ED8\u8BA4\u4E0D\u5728\u77E5\u8BC6\u5E93\u4E2D\u663E\u793A\uFF0C\u53EF\u5728\u5F52\u6863\u89C6\u56FE\u4E2D\u627E\u56DE\u3002")}okText={t("\u5F52\u6863")}cancelText={t("\u53D6\u6D88")}onConfirm={()=>void archive()}><Tooltip title={document.status==='ARCHIVED'?t("\u5DF2\u5F52\u6863"):t("\u5F52\u6863")}><Button type="text"aria-label={t("\u5F52\u6863")}icon={<InboxOutlined/>}disabled={document.status==='ARCHIVED'}/></Tooltip></Popconfirm>
    <Popconfirm title={t("\u5220\u9664\u8FD9\u7BC7\u6587\u6863\uFF1F")}description={t("\u8BE5\u64CD\u4F5C\u4F1A\u540C\u65F6\u5220\u9664\u5168\u6587\u7D22\u5F15\u548C\u6807\u7B7E\u5173\u8054\u3002")}okText={t("\u5220\u9664")}cancelText={t("\u53D6\u6D88")}okButtonProps={{danger:true}}onConfirm={()=>void remove()}><Tooltip title={t("\u5220\u9664")}><Button type="text"danger aria-label={t("\u5220\u9664")}icon={<DeleteOutlined/>}/></Tooltip></Popconfirm>
  </Space>
  return <>{contextHolder}<Drawer className="document-detail-drawer" width="min(760px, 76vw)" open={Boolean(document)} onClose={onClose} title={document?.title} extra={actions}>
    {document&&<article className="document-reader">
      <header className="document-reader__hero">
        <span className="document-reader__source">{document.source ||t("\u7F51\u9875")}</span>
        <Typography.Title>{document.title}</Typography.Title>
        {document.summary&&<Typography.Paragraph className="document-reader__summary">{document.summary}</Typography.Paragraph>}
      </header>
      <Descriptions className="document-reader__meta" size="small" column={2} items={[{key:'source',label:t("\u6765\u6E90"),children:document.source||t("\u7F51\u9875")},{key:'words',label:t("\u5B57\u6570"),children:document.wordCount.toLocaleString()},{key:'url',label:'URL',span:2,children:<Typography.Text ellipsis={{tooltip:document.url}}>{document.url}</Typography.Text>}]}/>
      <Space wrap className="document-reader__tags">{tagsDraft.map(tag=><Tag color="green" key={tag} closable onClose={()=>removeTag(tag)}>{tag}</Tag>)}{autoTags.map(tag=><Tag color="geekblue" key={`auto-${tag}`} className="document-tag-auto">{tag} {t("\xB7 \u81EA\u52A8")}</Tag>)}<Input size="small"prefix={<PlusOutlined/>}value={tagInput}onChange={event=>setTagInput(event.target.value)}onPressEnter={addTag}placeholder={t("\u65B0\u589E\u6807\u7B7E")}style={{width:140}}/><Tag>{document.status}</Tag></Space>
      <div className="markdown-body">{document.markdown?<ReactMarkdown remarkPlugins={[remarkGfm]} components={{img:({node: _node, ...props})=><img {...props} loading="lazy" decoding="async"/>}}>{markdownPreview}</ReactMarkdown>:<Empty description={t("\u8FD9\u7BC7\u6587\u6863\u6CA1\u6709\u53EF\u9605\u8BFB\u7684 Markdown \u6B63\u6587")}/>}</div>
      {isPreview&&<div className="document-reader__continue"><span>{t("\u5DF2\u5148\u52A0\u8F7D\u524D")} {markdownPreview.length.toLocaleString()} {t("\u5B57\uFF0C\u5269\u4F59\u5185\u5BB9\u6309\u9700\u5C55\u5F00")}</span><Button onClick={()=>setShowFullDocument(true)}>{t("\u52A0\u8F7D\u5B8C\u6574\u6B63\u6587")}</Button></div>}
      <Space className="document-reader__footer"><Button icon={<CopyOutlined/>} disabled={!document.markdown} onClick={()=>void copyMarkdown(document.markdown ?? '')}>{t("\u590D\u5236 Markdown")}</Button><Button icon={<ExportOutlined/>}href={`data:text/markdown;charset=utf-8,${encodeURIComponent(document.markdown??'')}`}download={`${document.title}.md`}onClick={()=>onExported?.(document)}>{t("\u5BFC\u51FA Markdown")}</Button></Space>
    </article>}
  </Drawer></>
}