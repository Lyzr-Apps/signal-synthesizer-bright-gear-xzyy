'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import parseLLMJson from '@/lib/jsonParser'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Clipboard,
  Check,
  Trash2,
  Zap,
  X,
  Tag,
  AlertCircle,
  RotateCcw,
  Activity,
  History,
} from 'lucide-react'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const SYNTHESIS_AGENT_ID = '699bbbbb071399e40ad3523c'
const MAX_CHARS = 10000
const HISTORY_KEY = 'signal-synthesizer-history'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface SynthesisResult {
  signal_summary: string[]
  narrative_compression: string
  tags: string[]
  diagnostic_note: string
}

interface HistoryEntry {
  id: string
  timestamp: string
  input: string
  output: SynthesisResult
  firstTag: string
  firstBulletPreview: string
}

// ─── HELPER: Extract Agent Result ────────────────────────────────────────────

function extractAgentResult(result: any): SynthesisResult | null {
  // Path 1: result.response.result is already the parsed object
  if (result?.response?.result && typeof result.response.result === 'object' && !Array.isArray(result.response.result)) {
    const r = result.response.result
    if (r.signal_summary || r.narrative_compression || r.tags || r.diagnostic_note) {
      return normalizeSynthesis(r)
    }
    if (r.result && typeof r.result === 'object') {
      return normalizeSynthesis(r.result)
    }
  }

  // Path 2: result.response.result is a string that needs JSON parsing
  if (typeof result?.response?.result === 'string') {
    const parsed = parseLLMJson(result.response.result)
    if (parsed && typeof parsed === 'object') {
      if (parsed.signal_summary || parsed.narrative_compression) return normalizeSynthesis(parsed)
      if (parsed.result) return normalizeSynthesis(parsed.result)
    }
  }

  // Path 3: Check raw_response
  if (typeof result?.raw_response === 'string') {
    const parsed = parseLLMJson(result.raw_response)
    if (parsed && typeof parsed === 'object') {
      if (parsed.signal_summary || parsed.narrative_compression) return normalizeSynthesis(parsed)
      if (parsed.result) return normalizeSynthesis(parsed.result)
    }
  }

  // Path 4: result.response itself
  if (result?.response && typeof result.response === 'object') {
    if (result.response.signal_summary || result.response.narrative_compression) {
      return normalizeSynthesis(result.response)
    }
  }

  return null
}

function normalizeSynthesis(data: any): SynthesisResult {
  return {
    signal_summary: Array.isArray(data?.signal_summary) ? data.signal_summary : [],
    narrative_compression: typeof data?.narrative_compression === 'string' ? data.narrative_compression : '',
    tags: Array.isArray(data?.tags) ? data.tags : [],
    diagnostic_note: typeof data?.diagnostic_note === 'string' ? data.diagnostic_note : '',
  }
}

// ─── SAMPLE DATA ─────────────────────────────────────────────────────────────

const SAMPLE_INPUT = `Federal Reserve signals potential rate pause in March. European markets rally on energy supply improvements. Tech sector earnings beat expectations across major players. Emerging market currencies stabilize after Q4 volatility. Supply chain disruptions in semiconductor industry continue to ease, but automotive sector faces new headwinds from rare earth mineral shortages. Consumer confidence index rises for third consecutive month.`

const SAMPLE_OUTPUT: SynthesisResult = {
  signal_summary: [
    'Central bank policy pivoting toward pause signals end of tightening cycle',
    'Energy supply normalization driving European equity recovery',
    'Tech earnings resilience suggests sector rotation may accelerate',
    'EM currency stabilization indicates reduced risk-off sentiment globally',
    'Semiconductor supply chain improvements offset by automotive raw material constraints',
  ],
  narrative_compression:
    'Global macro conditions are converging toward a risk-on environment driven by central bank dovishness, easing supply chains, and resilient corporate earnings. While structural risks persist in commodity-dependent sectors, the overall signal pattern suggests a transitional phase from defensive to growth positioning.',
  tags: ['macro-pivot', 'risk-on', 'supply-chain'],
  diagnostic_note:
    'Input contained 7 distinct signal vectors with moderate cross-correlation, suitable for thematic clustering.',
}

// ─── HISTORY HELPERS ─────────────────────────────────────────────────────────

function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(entries: HistoryEntry[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 50)))
  } catch {
    // localStorage full or unavailable
  }
}

function createHistoryEntry(input: string, output: SynthesisResult): HistoryEntry {
  const tags = Array.isArray(output?.tags) ? output.tags : []
  const bullets = Array.isArray(output?.signal_summary) ? output.signal_summary : []
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    input,
    output,
    firstTag: tags[0] ?? '',
    firstBulletPreview: (bullets[0] ?? '').slice(0, 60) + ((bullets[0] ?? '').length > 60 ? '...' : ''),
  }
}

// ─── ERROR BOUNDARY ──────────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-bold mb-2 uppercase tracking-wide">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: '' })}
              className="px-4 py-2 bg-foreground text-background text-sm font-bold uppercase tracking-wide border-2 border-foreground"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── MARKDOWN RENDERER ──────────────────────────────────────────────────────

function formatInline(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-bold">
        {part}
      </strong>
    ) : (
      part
    )
  )
}

function renderMarkdown(text: string) {
  if (!text) return null
  return (
    <div className="space-y-2">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### '))
          return (
            <h4 key={i} className="font-bold text-sm mt-3 mb-1 uppercase tracking-wide">
              {line.slice(4)}
            </h4>
          )
        if (line.startsWith('## '))
          return (
            <h3 key={i} className="font-bold text-base mt-3 mb-1 uppercase tracking-wide">
              {line.slice(3)}
            </h3>
          )
        if (line.startsWith('# '))
          return (
            <h2 key={i} className="font-bold text-lg mt-4 mb-2 uppercase tracking-wide">
              {line.slice(2)}
            </h2>
          )
        if (line.startsWith('- ') || line.startsWith('* '))
          return (
            <li key={i} className="ml-4 list-disc text-sm leading-relaxed">
              {formatInline(line.slice(2))}
            </li>
          )
        if (/^\d+\.\s/.test(line))
          return (
            <li key={i} className="ml-4 list-decimal text-sm leading-relaxed">
              {formatInline(line.replace(/^\d+\.\s/, ''))}
            </li>
          )
        if (!line.trim()) return <div key={i} className="h-1" />
        return (
          <p key={i} className="text-sm leading-relaxed">
            {formatInline(line)}
          </p>
        )
      })}
    </div>
  )
}

// ─── HISTORY SIDEBAR COMPONENT ───────────────────────────────────────────────

function HistorySidebar({
  history,
  onSelect,
  onClear,
  selectedId,
}: {
  history: HistoryEntry[]
  onSelect: (entry: HistoryEntry) => void
  onClear: () => void
  selectedId: string | null
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-foreground">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">History</span>
        </div>
        {history.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1">
        {history.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">No history yet</p>
          </div>
        ) : (
          <div className="py-1">
            {history.map((entry) => {
              const date = new Date(entry.timestamp)
              const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
              return (
                <button
                  key={entry.id}
                  onClick={() => onSelect(entry)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-muted hover:bg-muted transition-colors',
                    selectedId === entry.id && 'bg-muted'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground font-mono uppercase">
                      {dateStr} {timeStr}
                    </span>
                    {entry.firstTag && (
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-accent text-accent-foreground px-1.5 py-0.5">
                        {entry.firstTag}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground leading-snug line-clamp-2">
                    {entry.firstBulletPreview || 'No preview'}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// ─── OUTPUT SECTION COMPONENT ────────────────────────────────────────────────

function OutputSection({
  label,
  icon,
  children,
  loading,
}: {
  label: string
  icon: React.ReactNode
  children: React.ReactNode
  loading: boolean
}) {
  return (
    <div className="border-2 border-foreground bg-card">
      <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-foreground bg-muted">
        {icon}
        <span className="text-xs font-bold uppercase tracking-widest">{label}</span>
      </div>
      <div className="px-4 py-3 min-h-[48px]">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function Page() {
  // State
  const [input, setInput] = useState('')
  const [output, setOutput] = useState<SynthesisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [sampleMode, setSampleMode] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  // Sample data toggle
  useEffect(() => {
    if (sampleMode) {
      setInput(SAMPLE_INPUT)
      setOutput(SAMPLE_OUTPUT)
      setError(null)
    } else {
      setInput('')
      setOutput(null)
      setError(null)
      setSelectedHistoryId(null)
    }
  }, [sampleMode])

  // Synthesize handler
  const handleSynthesize = useCallback(async () => {
    if (!input.trim() || loading) return

    setLoading(true)
    setError(null)
    setOutput(null)
    setActiveAgentId(SYNTHESIS_AGENT_ID)

    try {
      const result = await callAIAgent(input, SYNTHESIS_AGENT_ID)

      if (result.success) {
        const parsed = extractAgentResult(result)
        if (parsed) {
          setOutput(parsed)
          // Save to history
          const entry = createHistoryEntry(input, parsed)
          const updated = [entry, ...history]
          setHistory(updated)
          saveHistory(updated)
          setSelectedHistoryId(entry.id)
        } else {
          setError('Could not parse the synthesis result. Please try again.')
        }
      } else {
        setError(result?.error ?? result?.response?.message ?? 'Synthesis failed. Please try again.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setLoading(false)
      setActiveAgentId(null)
    }
  }, [input, loading, history])

  // Clear handler
  const handleClear = useCallback(() => {
    setInput('')
    setOutput(null)
    setError(null)
    setSelectedHistoryId(null)
    setSampleMode(false)
  }, [])

  // Copy output
  const handleCopy = useCallback(async () => {
    if (!output) return
    const bullets = Array.isArray(output.signal_summary) ? output.signal_summary : []
    const tags = Array.isArray(output.tags) ? output.tags : []
    const text = [
      'SIGNAL SUMMARY',
      ...bullets.map((b, i) => `${i + 1}. ${b}`),
      '',
      'NARRATIVE COMPRESSION',
      output.narrative_compression ?? '',
      '',
      'TAGS',
      tags.join(', '),
      '',
      'DIAGNOSTIC NOTE',
      output.diagnostic_note ?? '',
    ].join('\n')

    const success = await copyToClipboard(text)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [output])

  // History select
  const handleHistorySelect = useCallback((entry: HistoryEntry) => {
    setInput(entry.input)
    setOutput(entry.output)
    setError(null)
    setSelectedHistoryId(entry.id)
    setSampleMode(false)
  }, [])

  // History clear
  const handleHistoryClear = useCallback(() => {
    setHistory([])
    saveHistory([])
    setSelectedHistoryId(null)
  }, [])

  const charCount = input.length
  const isOverLimit = charCount > MAX_CHARS
  const canSynthesize = input.trim().length > 0 && !loading && !isOverLimit

  const signalSummary = Array.isArray(output?.signal_summary) ? output.signal_summary : []
  const narrativeCompression = typeof output?.narrative_compression === 'string' ? output.narrative_compression : ''
  const tags = Array.isArray(output?.tags) ? output.tags : []
  const diagnosticNote = typeof output?.diagnostic_note === 'string' ? output.diagnostic_note : ''

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
        {/* ─── HEADER ────────────────────────────────────────────────── */}
        <header className="border-b-2 border-foreground bg-background">
          <div className="flex items-center justify-between px-4 py-3 max-w-[1400px] mx-auto w-full">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="h-8 w-8 p-0 border-2 border-foreground"
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="w-4 h-4" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4" />
                )}
              </Button>
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                <h1 className="text-lg font-bold uppercase tracking-widest">Signal Synthesizer</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Sample Data</span>
                <button
                  role="switch"
                  aria-checked={sampleMode}
                  onClick={() => setSampleMode(!sampleMode)}
                  className={cn(
                    'relative inline-flex h-5 w-9 items-center border-2 border-foreground transition-colors',
                    sampleMode ? 'bg-primary' : 'bg-muted'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-3 w-3 transform bg-foreground transition-transform',
                      sampleMode ? 'translate-x-4' : 'translate-x-0.5',
                      sampleMode && 'bg-primary-foreground'
                    )}
                  />
                </button>
              </label>
            </div>
          </div>
        </header>

        {/* ─── BODY ──────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ─── SIDEBAR ──────────────────────────────────────────────── */}
          {sidebarOpen && (
            <aside className="w-64 flex-shrink-0 border-r-2 border-foreground bg-background overflow-hidden">
              <HistorySidebar
                history={history}
                onSelect={handleHistorySelect}
                onClear={handleHistoryClear}
                selectedId={selectedHistoryId}
              />
            </aside>
          )}

          {/* ─── MAIN CONTENT ─────────────────────────────────────────── */}
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-[1200px] mx-auto p-4 md:p-6">
              <div className="flex flex-col lg:flex-row gap-4 md:gap-6">
                {/* ─── INPUT PANEL ──────────────────────────────────────── */}
                <div className="w-full lg:w-[45%] flex-shrink-0">
                  <div className="border-2 border-foreground bg-card">
                    <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-foreground bg-muted">
                      <Activity className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">Input</span>
                    </div>
                    <div className="p-4">
                      <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Paste raw notes, bullets, or news summary here..."
                        className="min-h-[280px] md:min-h-[360px] font-mono text-sm border-2 border-foreground bg-background resize-none focus-visible:ring-1 focus-visible:ring-primary leading-relaxed"
                        maxLength={MAX_CHARS + 100}
                      />
                      <div className="flex items-center justify-between mt-3">
                        <span
                          className={cn(
                            'text-xs font-mono',
                            isOverLimit ? 'text-primary font-bold' : 'text-muted-foreground'
                          )}
                        >
                          {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleClear}
                            disabled={loading || (!input && !output)}
                            className="h-8 text-xs font-bold uppercase tracking-wide border-2 border-foreground"
                          >
                            <X className="w-3.5 h-3.5 mr-1.5" />
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSynthesize}
                            disabled={!canSynthesize}
                            className="h-8 text-xs font-bold uppercase tracking-wide bg-primary text-primary-foreground border-2 border-foreground hover:bg-primary/90"
                          >
                            {loading ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Processing
                              </>
                            ) : (
                              <>
                                <Zap className="w-3.5 h-3.5 mr-1.5" />
                                Synthesize
                              </>
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Inline error */}
                      {error && (
                        <div className="mt-3 p-3 border-2 border-primary bg-primary/5 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-xs text-foreground">{error}</p>
                            <button
                              onClick={handleSynthesize}
                              className="text-xs font-bold uppercase tracking-wide text-primary mt-1 flex items-center gap-1 hover:underline"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Retry
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ─── AGENT INFO ────────────────────────────────────────── */}
                  <div className="mt-4 border-2 border-foreground bg-card">
                    <div className="px-4 py-2 border-b-2 border-foreground bg-muted">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Agent Status</span>
                    </div>
                    <div className="px-4 py-2 flex items-center gap-3">
                      <div className={cn('w-2 h-2 flex-shrink-0', activeAgentId ? 'bg-primary animate-pulse' : 'bg-muted-foreground')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wide">Synthesis Agent</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{SYNTHESIS_AGENT_ID}</p>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {activeAgentId ? 'Active' : 'Idle'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ─── OUTPUT PANEL ─────────────────────────────────────── */}
                <div className="w-full lg:w-[55%]">
                  <div className="border-2 border-foreground bg-card">
                    <div className="flex items-center justify-between px-4 py-2 border-b-2 border-foreground bg-muted">
                      <span className="text-xs font-bold uppercase tracking-widest">Output</span>
                      {output && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopy}
                          className="h-7 text-xs font-bold uppercase tracking-wide gap-1.5"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Clipboard className="w-3.5 h-3.5" />
                              Copy
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    <div className="p-4 space-y-4">
                      {/* Section 1: Signal Summary */}
                      <OutputSection
                        label="Signal Summary"
                        icon={<Zap className="w-3.5 h-3.5" />}
                        loading={loading}
                      >
                        {signalSummary.length > 0 ? (
                          <ul className="space-y-2">
                            {signalSummary.map((bullet, i) => (
                              <li key={i} className="flex gap-2 text-sm leading-relaxed">
                                <span className="text-primary font-bold flex-shrink-0 font-mono">{String(i + 1).padStart(2, '0')}</span>
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Awaiting synthesis...</p>
                        )}
                      </OutputSection>

                      {/* Section 2: Narrative Compression */}
                      <OutputSection
                        label="Narrative Compression"
                        icon={<Activity className="w-3.5 h-3.5" />}
                        loading={loading}
                      >
                        {narrativeCompression ? (
                          <div className="text-sm leading-relaxed">{renderMarkdown(narrativeCompression)}</div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Awaiting synthesis...</p>
                        )}
                      </OutputSection>

                      {/* Section 3: Tags */}
                      <OutputSection
                        label="Tags"
                        icon={<Tag className="w-3.5 h-3.5" />}
                        loading={loading}
                      >
                        {tags.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {tags.map((tag, i) => (
                              <span
                                key={i}
                                className="inline-block text-xs font-bold uppercase tracking-wide bg-accent text-accent-foreground px-3 py-1 border-2 border-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Awaiting synthesis...</p>
                        )}
                      </OutputSection>

                      {/* Section 4: Diagnostic Note */}
                      <OutputSection
                        label="Diagnostic Note"
                        icon={<AlertCircle className="w-3.5 h-3.5" />}
                        loading={loading}
                      >
                        {diagnosticNote ? (
                          <p className="text-sm italic leading-relaxed text-muted-foreground">{diagnosticNote}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Awaiting synthesis...</p>
                        )}
                      </OutputSection>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </ErrorBoundary>
  )
}
