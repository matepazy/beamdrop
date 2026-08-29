import { ArrowDown, ArrowUp, Check, ImagePlus, MousePointer2, Pencil, PenLine, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatBytes } from '../lib/format'
import type { CanvasImage, CanvasPoint, CanvasSession, CanvasStroke, CanvasTraffic } from '../hooks/useBeam'

type Props = {
  canvas: CanvasSession
  traffic: CanvasTraffic
  displayName: string
  onClose(): void
  onRename(name: string): void
  onStroke(stroke: CanvasStroke): void
  onImage(image: CanvasImage): void
}

const uid = () => crypto.randomUUID?.().replaceAll('-', '_') ?? `${Date.now()}_${Math.random()}`
const colors = ['#17191e', '#4459c5', '#d0523b', '#15956a', '#e29a28']

export function CanvasBoard({ canvas, traffic, displayName, onClose, onRename, onStroke, onImage }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const activeStroke = useRef<CanvasPoint[]>([])
  const strokeId = useRef<string | null>(null)
  const lastBroadcast = useRef(0)
  const knownStrokeLengths = useRef(new Map<string, number>())
  const labelTimers = useRef(new Map<string, number>())
  const [tool, setTool] = useState<'draw' | 'pan'>('draw')
  const [color, setColor] = useState(colors[0])
  const [width, setWidth] = useState(4)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [draft, setDraft] = useState<CanvasPoint[] | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number; offset: { x: number; y: number } } | null>(null)
  const [status, setStatus] = useState('')
  const [activeStrokeIds, setActiveStrokeIds] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(canvas.name)

  const canRename = canvas.starter === displayName
  const saveName = () => {
    const nextName = nameDraft.trim()
    if (nextName) onRename(nextName)
    setRenaming(false)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    for (const stroke of canvas.strokes) {
      const previousLength = knownStrokeLengths.current.get(stroke.id) ?? 0
      knownStrokeLengths.current.set(stroke.id, stroke.points.length)
      if (stroke.points.length <= previousLength) continue
      setActiveStrokeIds(current => new Set(current).add(stroke.id))
      const previousTimer = labelTimers.current.get(stroke.id)
      if (previousTimer) window.clearTimeout(previousTimer)
      labelTimers.current.set(stroke.id, window.setTimeout(() => {
        setActiveStrokeIds(current => { const next = new Set(current); next.delete(stroke.id); return next })
        labelTimers.current.delete(stroke.id)
      }, 900))
    }
    return () => undefined
  }, [canvas.strokes])

  useEffect(() => () => { for (const timer of labelTimers.current.values()) window.clearTimeout(timer) }, [])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find(item => item.type.startsWith('image/'))
      if (!file) return
      event.preventDefault()
      void compressAndAdd(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const toCanvasPoint = (event: React.PointerEvent) => {
    const rect = stage.current!.getBoundingClientRect()
    return { x: (event.clientX - rect.left - offset.x) / zoom, y: (event.clientY - rect.top - offset.y) / zoom }
  }
  const finishStroke = () => {
    const points = activeStroke.current
    if (points.length) onStroke({ id: strokeId.current ?? uid(), points, color, width, author: displayName })
    activeStroke.current = []; strokeId.current = null; setDraft(null)
  }
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pan' || event.button === 1 || event.button === 2) { setDragStart({ x: event.clientX, y: event.clientY, offset }); return }
    const point = toCanvasPoint(event); activeStroke.current = [point]; strokeId.current = uid(); lastBroadcast.current = performance.now(); setDraft([point])
  }
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart) { setOffset({ x: dragStart.offset.x + event.clientX - dragStart.x, y: dragStart.offset.y + event.clientY - dragStart.y }); return }
    if (!activeStroke.current.length) return
    const point = toCanvasPoint(event); const last = activeStroke.current.at(-1)!
    if (Math.hypot(point.x - last.x, point.y - last.y) < 1.5) return
    activeStroke.current = [...activeStroke.current, point]; setDraft(activeStroke.current)
    const now = performance.now()
    if (now - lastBroadcast.current >= 55) {
      lastBroadcast.current = now
      onStroke({ id: strokeId.current!, points: activeStroke.current, color, width, author: displayName })
    }
  }
  const compressAndAdd = async (file: File) => {
    if (!file.type.startsWith('image/')) { setStatus('Choose an image file.'); return }
    setStatus('Compressing image…')
    try {
      const source = await createImageBitmap(file)
      const scale = Math.min(1, 1280 / Math.max(source.width, source.height))
      const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale))
      const output = document.createElement('canvas'); output.width = width; output.height = height
      output.getContext('2d')!.drawImage(source, 0, 0, width, height); source.close()
      const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, 'image/webp', .72))
      if (!blob || blob.size > 950_000) { setStatus('Image is still too large after compression. Choose a smaller image.'); return }
      const dataUrl = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob) })
      onImage({ id: uid(), dataUrl, x: 80 - offset.x / zoom, y: 80 - offset.y / zoom, width, height, author: displayName })
      setStatus(`Image compressed to ${Math.round(blob.size / 1024)} KB.`)
    } catch { setStatus('Could not compress that image. Try another file.') }
  }
  const shownStrokes = draft ? [...canvas.strokes, { id: 'draft', points: draft, color, width, author: displayName }] : canvas.strokes

  return <section className="canvas-board" aria-label="Collaborative canvas">
    <header className="canvas-board__head">
      <div className="canvas-board__title"><span className="canvas-board__eyebrow">Live canvas</span><div className="canvas-board__name-row">{renaming ? <><input aria-label="Canvas name" autoFocus value={nameDraft} maxLength={80} onChange={event => setNameDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') saveName(); if (event.key === 'Escape') { setNameDraft(canvas.name); setRenaming(false) } }} /><button type="button" className="canvas-board__rename" onClick={saveName}><Check size={18} /> Save</button></> : <>{<strong>{canvas.name}</strong>}{canRename && <button type="button" className="canvas-board__rename" onClick={() => { setNameDraft(canvas.name); setRenaming(true) }}><PenLine size={17} /> Rename</button>}</>}</div></div>
      <div className="canvas-board__actions">
        <div className="canvas-board__traffic" role="status" aria-live="polite" aria-atomic="true" aria-label={`Canvas data: ${formatBytes(traffic.sent)} sent and ${formatBytes(traffic.received)} received`}><span title="Canvas data sent"><ArrowUp size={14} aria-hidden="true" />S {formatBytes(traffic.sent)}</span><span title="Canvas data received"><ArrowDown size={14} aria-hidden="true" />R {formatBytes(traffic.received)}</span></div>
        <button type="button" className="canvas-board__close" onClick={onClose} aria-label="Close canvas"><X size={19} /></button>
      </div>
    </header>
    <div className="canvas-board__tools" role="toolbar" aria-label="Canvas tools">
      <button type="button" className={tool === 'draw' ? 'is-active' : ''} onClick={() => setTool('draw')} aria-pressed={tool === 'draw'}><Pencil size={17} /> Draw</button>
      <button type="button" className={tool === 'pan' ? 'is-active' : ''} onClick={() => setTool('pan')} aria-pressed={tool === 'pan'}><MousePointer2 size={17} /> Pan</button>
      <span className="canvas-board__separator" />
      {colors.map(value => <button key={value} type="button" className={`canvas-board__color ${color === value ? 'is-active' : ''}`} style={{ '--swatch': value } as React.CSSProperties} onClick={() => setColor(value)} aria-label={`Use ${value} ink`} aria-pressed={color === value} />)}
      <label className="canvas-board__custom-color" title="Custom ink color"><span>Custom color</span><input type="color" value={color} onChange={event => setColor(event.target.value)} aria-label="Choose custom ink color" /></label>
      <label className="canvas-board__width">Stroke <input aria-label="Stroke width" type="range" min="2" max="14" value={width} onChange={event => setWidth(Number(event.target.value))} /></label>
      <span className="canvas-board__separator" />
      <button type="button" onClick={() => imageInput.current?.click()}><ImagePlus size={17} /> Paste image</button>
      <button type="button" onClick={() => setZoom(value => Math.max(.35, value - .15))} aria-label="Zoom out"><ZoomOut size={17} /></button>
      <button type="button" onClick={() => setZoom(value => Math.min(2.5, value + .15))} aria-label="Zoom in"><ZoomIn size={17} /></button>
    </div>
    <input ref={imageInput} className="sr-only" type="file" accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void compressAndAdd(file); event.currentTarget.value = '' }} />
    <div ref={stage} className={`canvas-board__stage canvas-board__stage--${tool}`} onContextMenu={event => event.preventDefault()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { setDragStart(null); finishStroke() }} onPointerCancel={() => { setDragStart(null); finishStroke() }}>
      <svg className="canvas-board__drawing" aria-label="Shared drawing surface">
        <g transform={`translate(${offset.x} ${offset.y}) scale(${zoom})`}>
          {canvas.images.map(image => <image key={image.id} href={image.dataUrl} x={image.x} y={image.y} width={image.width} height={image.height} preserveAspectRatio="xMidYMid meet" />)}
          {shownStrokes.map(stroke => <g key={stroke.id}><polyline points={stroke.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />{(stroke.id === 'draft' || activeStrokeIds.has(stroke.id)) && stroke.points.length > 0 && <text className="canvas-stroke-label" x={stroke.points.at(-1)!.x + 9} y={stroke.points.at(-1)!.y - 8}>{stroke.author}</text>}</g>)}
        </g>
      </svg>
      {!canvas.strokes.length && !canvas.images.length && <div className="canvas-board__hint"><Pencil size={22} /><strong>Start sketching together</strong><span>Drag to draw. Switch to Pan to explore the endless surface.</span></div>}
    </div>
    <footer className="canvas-board__foot"><span>{status || 'Changes sync directly between everyone in this Beam.'}</span><span>{Math.round(zoom * 100)}%</span></footer>
  </section>
}
