'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
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
  Gauge,
  Radio,
  BookOpen,
  FlaskConical,
  Archive,
  ArrowRight,
  Send,
  ChevronRight,
  ListFilter,
  CircleDot,
} from 'lucide-react'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const FORGE_AGENT_ID = '699bbbbb071399e40ad3523c'
const MAX_CHARS = 10000
const HISTORY_KEY = 'signal-forge-history'
const PIPELINE_DRAFTS_KEY = 'signal-forge-pipeline-drafts'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ForgeResult {
  signal_summary: string[]
  narrative_compression: string
  tags: string[]
  diagnostic_note: string
  confidence_score: number
}

type RouteType = 'broadcast' | 'publishing' | 'apocrypha' | 'store'

type PipelineStage = 'input' | 'forge' | 'route' | 'output'

interface HistoryEntry {
  id: string
  timestamp: string
  input: string
  output: ForgeResult
  firstTag: string
  firstBulletPreview: string
  route?: RouteType | null
}

interface EpisodeDraft {
  title: string
  summary: string
  tags: string[]
  confidence: number
  status: 'draft'
}

interface ClipDraft {
  headline: string
  body: string
  tags: string[]
  route: string
  status: 'draft'
}

interface ProductDraft {
  name: string
  description: string
  category: string
  metadata: {
    confidence: number
    signal_count: number
    source_length: number
  }
  status: 'draft'
}

interface PipelineDraft {
  id: string
  timestamp: string
  route: RouteType
  input: string
  output: ForgeResult
  drafts: {
    episode: EpisodeDraft
    clip: ClipDraft
    product: ProductDraft
  }
}

// ─── ROUTE DEFINITIONS ──────────────────────────────────────────────────────

const ROUTES: { key: RouteType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    key: 'broadcast',
    label: 'Broadcast',
    description: 'Optimized for wide distribution -- news, social, alerts',
    icon: <Radio className="w-4 h-4" />,
  },
  {
    key: 'publishing',
    label: 'Publishing',
    description: 'Editorial quality -- articles, reports, documentation',
    icon: <BookOpen className="w-4 h-4" />,
  },
  {
    key: 'apocrypha',
    label: 'Apocrypha',
    description: 'Experimental/speculative -- creative, unverified, exploratory',
    icon: <FlaskConical className="w-4 h-4" />,
  },
  {
    key: 'store',
    label: 'Store',
    description: 'Structured for cataloging -- databases, archives, metadata',
    icon: <Archive className="w-4 h-4" />,
  },
]

// ─── HELPER: Extract Agent Result ────────────────────────────────────────────

function extractAgentResult(result: any): ForgeResult | null {
  // Path 1: result.response.result is already the parsed object
  if (result?.response?.result && typeof result.response.result === 'object' && !Array.isArray(result.response.result)) {
    const r = result.response.result
    if (r.signal_summary || r.narrative_compression || r.tags || r.diagnostic_note || r.confidence_score !== undefined) {
      return normalizeForgeResult(r)
    }
    if (r.result && typeof r.result === 'object') {
      return normalizeForgeResult(r.result)
    }
  }

  // Path 2: result.response.result is a string that needs JSON parsing
  if (typeof result?.response?.result === 'string') {
    const parsed = parseLLMJson(result.response.result)
    if (parsed && typeof parsed === 'object') {
      if (parsed.signal_summary || parsed.narrative_compression) return normalizeForgeResult(parsed)
      if (parsed.result) return normalizeForgeResult(parsed.result)
    }
  }

  // Path 3: Check raw_response
  if (typeof result?.raw_response === 'string') {
    const parsed = parseLLMJson(result.raw_response)
    if (parsed && typeof parsed === 'object') {
      if (parsed.signal_summary || parsed.narrative_compression) return normalizeForgeResult(parsed)
      if (parsed.result) return normalizeForgeResult(parsed.result)
    }
  }

  // Path 4: result.response itself
  if (result?.response && typeof result.response === 'object') {
    if (result.response.signal_summary || result.response.narrative_compression) {
      return normalizeForgeResult(result.response)
    }
  }

  return null
}

function normalizeForgeResult(data: any): ForgeResult {
  return {
    signal_summary: Array.isArray(data?.signal_summary) ? data.signal_summary : [],
    narrative_compression: typeof data?.narrative_compression === 'string' ? data.narrative_compression : '',
    tags: Array.isArray(data?.tags) ? data.tags : [],
    diagnostic_note: typeof data?.diagnostic_note === 'string' ? data.diagnostic_note : '',
    confidence_score: typeof data?.confidence_score === 'number' ? data.confidence_score : 0,
  }
}

// ─── SAMPLE DATA ─────────────────────────────────────────────────────────────

const SAMPLE_INPUT = `Federal Reserve signals potential rate pause in March. European markets rally on energy supply improvements. Tech sector earnings beat expectations across major players. Emerging market currencies stabilize after Q4 volatility. Supply chain disruptions in semiconductor industry continue to ease, but automotive sector faces new headwinds from rare earth mineral shortages. Consumer confidence index rises for third consecutive month.`

const SAMPLE_OUTPUT: ForgeResult = {
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
  confidence_score: 78,
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

function createHistoryEntry(input: string, output: ForgeResult, route?: RouteType | null): HistoryEntry {
  const tags = Array.isArray(output?.tags) ? output.tags : []
  const bullets = Array.isArray(output?.signal_summary) ? output.signal_summary : []
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    input,
    output,
    firstTag: tags[0] ?? '',
    firstBulletPreview: (bullets[0] ?? '').slice(0, 60) + ((bullets[0] ?? '').length > 60 ? '...' : ''),
    route: route ?? null,
  }
}

// ─── PIPELINE DRAFT HELPERS ──────────────────────────────────────────────────

function createPipelineDraft(input: string, output: ForgeResult, route: RouteType): PipelineDraft {
  const tags = Array.isArray(output?.tags) ? output.tags : []
  const bullets = Array.isArray(output?.signal_summary) ? output.signal_summary : []
  const narrative = typeof output?.narrative_compression === 'string' ? output.narrative_compression : ''
  const diagnostic = typeof output?.diagnostic_note === 'string' ? output.diagnostic_note : ''
  const confidence = typeof output?.confidence_score === 'number' ? output.confidence_score : 0

  const episode: EpisodeDraft = {
    title: (tags[0] ? tags[0] + ' ' : '') + 'Signal Brief',
    summary: narrative,
    tags: tags,
    confidence: confidence,
    status: 'draft',
  }

  const clip: ClipDraft = {
    headline: bullets[0] ?? '',
    body: narrative.slice(0, 280),
    tags: tags,
    route: route,
    status: 'draft',
  }

  const product: ProductDraft = {
    name: tags[0] ?? 'Untitled Signal',
    description: diagnostic,
    category: route,
    metadata: {
      confidence: confidence,
      signal_count: bullets.length,
      source_length: input.length,
    },
    status: 'draft',
  }

  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    route,
    input,
    output,
    drafts: { episode, clip, product },
  }
}

function loadPipelineDrafts(): PipelineDraft[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(PIPELINE_DRAFTS_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function savePipelineDrafts(drafts: PipelineDraft[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PIPELINE_DRAFTS_KEY, JSON.stringify(drafts.slice(0, 100)))
  } catch {
    // localStorage full or unavailable
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

// ─── STAGE INDICATOR COMPONENT ──────────────────────────────────────────────

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: 'input', label: 'INPUT' },
  { key: 'forge', label: 'FORGE' },
  { key: 'route', label: 'ROUTE' },
  { key: 'output', label: 'OUTPUT' },
]

function getStageStatus(
  stageKey: PipelineStage,
  activeStage: PipelineStage,
  completedStages: Set<PipelineStage>
): 'active' | 'completed' | 'pending' {
  if (stageKey === activeStage) return 'active'
  if (completedStages.has(stageKey)) return 'completed'
  return 'pending'
}

function StageIndicators({
  activeStage,
  completedStages,
}: {
  activeStage: PipelineStage
  completedStages: Set<PipelineStage>
}) {
  return (
    <div className="flex items-center justify-center gap-0 px-4 py-3 border-b-2 border-foreground bg-background overflow-x-auto">
      {STAGES.map((stage, idx) => {
        const status = getStageStatus(stage.key, activeStage, completedStages)
        return (
          <React.Fragment key={stage.key}>
            <div
              className={cn(
                'flex items-center justify-center px-4 py-1.5 min-w-[80px] border-2 text-xs font-bold uppercase tracking-widest transition-colors',
                status === 'active' && 'bg-primary text-primary-foreground border-foreground',
                status === 'completed' && 'bg-secondary text-secondary-foreground border-foreground',
                status === 'pending' && 'bg-muted text-muted-foreground border-muted-foreground'
              )}
            >
              {stage.label}
            </div>
            {idx < STAGES.length - 1 && (
              <div
                className={cn(
                  'w-8 h-0.5 flex-shrink-0',
                  completedStages.has(stage.key) ? 'bg-foreground' : 'bg-muted-foreground'
                )}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── SIDEBAR COMPONENT (History + Pipeline) ─────────────────────────────────

function getConfidenceColor(score: number): string {
  if (score <= 30) return 'bg-destructive text-destructive-foreground'
  if (score <= 60) return 'bg-accent text-accent-foreground'
  return 'bg-secondary text-secondary-foreground'
}

function SidebarPanel({
  history,
  onHistorySelect,
  onHistoryClear,
  selectedHistoryId,
  pipelineItems,
  onPipelineRemove,
  onPipelineClear,
  highlightedPipelineId,
}: {
  history: HistoryEntry[]
  onHistorySelect: (entry: HistoryEntry) => void
  onHistoryClear: () => void
  selectedHistoryId: string | null
  pipelineItems: PipelineDraft[]
  onPipelineRemove: (id: string) => void
  onPipelineClear: () => void
  highlightedPipelineId: string | null
}) {
  return (
    <div className="flex flex-col h-full">
      {/* ─── HISTORY SECTION ────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-foreground">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">History</span>
        </div>
        {history.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onHistoryClear}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {history.length === 0 ? (
          <div className="px-4 py-6 text-center">
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
                  onClick={() => onHistorySelect(entry)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-muted hover:bg-muted transition-colors',
                    selectedHistoryId === entry.id && 'bg-muted'
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
                  {entry.route && (
                    <span className="inline-block mt-1 text-[9px] font-bold uppercase tracking-widest bg-secondary text-secondary-foreground px-1.5 py-0.5">
                      {entry.route}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </ScrollArea>

      {/* ─── DIVIDER ────────────────────────────────────────────────── */}
      <div className="border-t-4 border-foreground" />

      {/* ─── PIPELINE SECTION ───────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-foreground bg-muted">
        <div className="flex items-center gap-2">
          <ListFilter className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-widest">Pipeline</span>
          {pipelineItems.length > 0 && (
            <span className="text-[10px] font-bold font-mono bg-primary text-primary-foreground px-1.5 py-0.5">
              {pipelineItems.length}
            </span>
          )}
        </div>
        {pipelineItems.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onPipelineClear}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {pipelineItems.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">No queued items</p>
            <p className="text-[10px] text-muted-foreground mt-1">Forge a signal, select a route, and send to pipeline</p>
          </div>
        ) : (
          <div className="py-1">
            {pipelineItems.map((item) => {
              const date = new Date(item.timestamp)
              const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
              const summaryLine = Array.isArray(item.output?.signal_summary) ? (item.output.signal_summary[0] ?? '') : ''
              const itemTags = Array.isArray(item.output?.tags) ? item.output.tags : []
              const confidence = typeof item.output?.confidence_score === 'number' ? item.output.confidence_score : 0
              const isHighlighted = highlightedPipelineId === item.id
              return (
                <div
                  key={item.id}
                  className={cn(
                    'px-4 py-3 border-b border-muted transition-colors',
                    isHighlighted && 'bg-primary/5 border-l-4 border-l-primary'
                  )}
                >
                  {/* Row 1: Route badge + timestamp + delete */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest bg-secondary text-secondary-foreground px-1.5 py-0.5">
                      {item.route}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground font-mono uppercase">
                        {dateStr} {timeStr}
                      </span>
                      <button
                        onClick={() => onPipelineRemove(item.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {/* Row 2: First summary line */}
                  <p className="text-xs text-foreground leading-snug line-clamp-2 mb-1.5">
                    {summaryLine.slice(0, 80) || 'No summary'}
                    {summaryLine.length > 80 ? '...' : ''}
                  </p>
                  {/* Row 3: Confidence + Tags + Status */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn('text-[9px] font-bold font-mono px-1.5 py-0.5', getConfidenceColor(confidence))}>
                      {confidence}
                    </span>
                    {itemTags.slice(0, 2).map((tag, i) => (
                      <span
                        key={i}
                        className="text-[9px] font-bold uppercase tracking-wide bg-accent text-accent-foreground px-1 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                    <span className="ml-auto flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                      <CircleDot className="w-2.5 h-2.5" />
                      Queued
                    </span>
                  </div>
                </div>
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

// ─── CONFIDENCE BAR COMPONENT ────────────────────────────────────────────────

function ConfidenceBar({ score, loading }: { score: number; loading: boolean }) {
  const safeScore = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0

  const getBarColor = (s: number): string => {
    if (s <= 30) return 'bg-destructive'
    if (s <= 60) return 'bg-accent'
    return 'bg-secondary'
  }

  const getLabel = (s: number): string => {
    if (s <= 30) return 'LOW'
    if (s <= 60) return 'MEDIUM'
    return 'HIGH'
  }

  return (
    <OutputSection
      label="Confidence Score"
      icon={<Gauge className="w-3.5 h-3.5" />}
      loading={loading}
    >
      {safeScore > 0 || !loading ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {getLabel(safeScore)}
            </span>
            <span className="text-sm font-bold font-mono">
              {safeScore} / 100
            </span>
          </div>
          <div className="w-full h-3 bg-muted border-2 border-foreground overflow-hidden">
            <div
              className={cn('h-full transition-all duration-500', getBarColor(safeScore))}
              style={{ width: `${safeScore}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">Awaiting synthesis...</p>
      )}
    </OutputSection>
  )
}

// ─── ROUTE SELECTOR COMPONENT ────────────────────────────────────────────────

function RouteSelector({
  selectedRoute,
  onSelect,
}: {
  selectedRoute: RouteType | null
  onSelect: (route: RouteType) => void
}) {
  return (
    <div className="border-2 border-foreground bg-card">
      <div className="flex items-center gap-2 px-4 py-2 border-b-2 border-foreground bg-muted">
        <ArrowRight className="w-3.5 h-3.5" />
        <span className="text-xs font-bold uppercase tracking-widest">Route Selector</span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ROUTES.map((route) => {
            const isSelected = selectedRoute === route.key
            return (
              <button
                key={route.key}
                onClick={() => onSelect(route.key)}
                className={cn(
                  'text-left p-3 border-2 transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-foreground bg-card hover:bg-muted'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {route.icon}
                  <span className="text-xs font-bold uppercase tracking-widest">{route.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{route.description}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function Page() {
  // State
  const [input, setInput] = useState('')
  const [output, setOutput] = useState<ForgeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)
  const [sampleMode, setSampleMode] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<RouteType | null>(null)
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null)
  const pipelineMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pipelineItems, setPipelineItems] = useState<PipelineDraft[]>([])
  const [highlightedPipelineId, setHighlightedPipelineId] = useState<string | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pipeline stage tracking
  const [activeStage, setActiveStage] = useState<PipelineStage>('input')
  const [completedStages, setCompletedStages] = useState<Set<PipelineStage>>(new Set())

  // Load history and pipeline on mount
  useEffect(() => {
    setHistory(loadHistory())
    setPipelineItems(loadPipelineDrafts())
  }, [])

  // Sample data toggle
  useEffect(() => {
    if (sampleMode) {
      setInput(SAMPLE_INPUT)
      setOutput(SAMPLE_OUTPUT)
      setError(null)
      setActiveStage('output')
      setCompletedStages(new Set<PipelineStage>(['input', 'forge']))
      setSelectedRoute(null)
    } else {
      setInput('')
      setOutput(null)
      setError(null)
      setSelectedHistoryId(null)
      setSelectedRoute(null)
      setActiveStage('input')
      setCompletedStages(new Set<PipelineStage>())
    }
  }, [sampleMode])

  // Update active stage based on input content
  useEffect(() => {
    if (!loading && !output && input.trim().length > 0) {
      setActiveStage('input')
    }
  }, [input, loading, output])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (pipelineMessageTimerRef.current) {
        clearTimeout(pipelineMessageTimerRef.current)
      }
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
      }
    }
  }, [])

  // Forge handler
  const handleForge = useCallback(async () => {
    if (!input.trim() || loading) return

    setLoading(true)
    setError(null)
    setOutput(null)
    setActiveAgentId(FORGE_AGENT_ID)
    setActiveStage('forge')
    setCompletedStages(new Set<PipelineStage>(['input']))
    setPipelineMessage(null)

    try {
      const messageWithRoute = selectedRoute
        ? `[ROUTE: ${selectedRoute.toUpperCase()}]\n\n${input}`
        : input
      const result = await callAIAgent(messageWithRoute, FORGE_AGENT_ID)

      if (result.success) {
        const parsed = extractAgentResult(result)
        if (parsed) {
          setOutput(parsed)
          setActiveStage('output')
          setCompletedStages(new Set<PipelineStage>(['input', 'forge']))
          // Save to history
          const entry = createHistoryEntry(input, parsed, selectedRoute)
          const updated = [entry, ...history]
          setHistory(updated)
          saveHistory(updated)
          setSelectedHistoryId(entry.id)
        } else {
          setError('Could not parse the forge result. Please try again.')
          setActiveStage('input')
          setCompletedStages(new Set<PipelineStage>())
        }
      } else {
        setError(result?.error ?? result?.response?.message ?? 'Forge failed. Please try again.')
        setActiveStage('input')
        setCompletedStages(new Set<PipelineStage>())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
      setActiveStage('input')
      setCompletedStages(new Set<PipelineStage>())
    } finally {
      setLoading(false)
      setActiveAgentId(null)
    }
  }, [input, loading, history, selectedRoute])

  // Route selection handler
  const handleRouteSelect = useCallback((route: RouteType) => {
    setSelectedRoute(route)
    setActiveStage('route')
    setCompletedStages((prev) => {
      const next = new Set(prev)
      next.add('input')
      next.add('forge')
      return next
    })
  }, [])

  // Send to pipeline handler
  const handleSendToPipeline = useCallback(() => {
    if (!output || !selectedRoute) return

    const draft = createPipelineDraft(input, output, selectedRoute)

    // Add to pipeline state and persist
    setPipelineItems((prev) => {
      const updated = [draft, ...prev]
      savePipelineDrafts(updated)
      return updated
    })

    // Update stage to output completed
    setActiveStage('output')
    setCompletedStages(new Set<PipelineStage>(['input', 'forge', 'route']))

    // Update history entry with route
    setHistory((prev) => {
      const updated = prev.map((entry) =>
        entry.id === selectedHistoryId ? { ...entry, route: selectedRoute } : entry
      )
      saveHistory(updated)
      return updated
    })

    // Open sidebar and highlight the new pipeline item
    setSidebarOpen(true)
    setHighlightedPipelineId(draft.id)
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedPipelineId(null)
    }, 4000)

    // Show inline confirmation message
    setPipelineMessage(`Queued to ${selectedRoute.charAt(0).toUpperCase() + selectedRoute.slice(1)}`)
    if (pipelineMessageTimerRef.current) {
      clearTimeout(pipelineMessageTimerRef.current)
    }
    pipelineMessageTimerRef.current = setTimeout(() => {
      setPipelineMessage(null)
    }, 3000)
  }, [output, selectedRoute, input, selectedHistoryId])

  // Clear handler
  const handleClear = useCallback(() => {
    setInput('')
    setOutput(null)
    setError(null)
    setSelectedHistoryId(null)
    setSampleMode(false)
    setSelectedRoute(null)
    setPipelineMessage(null)
    setActiveStage('input')
    setCompletedStages(new Set<PipelineStage>())
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
      'CONFIDENCE SCORE',
      `${output.confidence_score ?? 0} / 100`,
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
    setSelectedRoute(entry.route ?? null)
    setActiveStage('output')
    setCompletedStages(new Set<PipelineStage>(['input', 'forge']))
    if (entry.route) {
      setCompletedStages(new Set<PipelineStage>(['input', 'forge', 'route']))
    }
  }, [])

  // History clear
  const handleHistoryClear = useCallback(() => {
    setHistory([])
    saveHistory([])
    setSelectedHistoryId(null)
  }, [])

  // Pipeline remove single item
  const handlePipelineRemove = useCallback((id: string) => {
    setPipelineItems((prev) => {
      const updated = prev.filter((item) => item.id !== id)
      savePipelineDrafts(updated)
      return updated
    })
  }, [])

  // Pipeline clear all
  const handlePipelineClear = useCallback(() => {
    setPipelineItems([])
    savePipelineDrafts([])
    setHighlightedPipelineId(null)
  }, [])

  const charCount = input.length
  const isOverLimit = charCount > MAX_CHARS
  const canForge = input.trim().length > 0 && !loading && !isOverLimit

  const signalSummary = Array.isArray(output?.signal_summary) ? output.signal_summary : []
  const narrativeCompression = typeof output?.narrative_compression === 'string' ? output.narrative_compression : ''
  const tags = Array.isArray(output?.tags) ? output.tags : []
  const diagnosticNote = typeof output?.diagnostic_note === 'string' ? output.diagnostic_note : ''
  const confidenceScore = typeof output?.confidence_score === 'number' ? output.confidence_score : 0

  const canSendToPipeline = output !== null && selectedRoute !== null

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
                <div>
                  <h1 className="text-lg font-bold uppercase tracking-widest leading-none">Signal Forge</h1>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground leading-none mt-0.5">Neon Pipeline</p>
                </div>
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

        {/* ─── STAGE INDICATORS ──────────────────────────────────────── */}
        <StageIndicators activeStage={activeStage} completedStages={completedStages} />

        {/* ─── BODY ──────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ─── SIDEBAR ──────────────────────────────────────────────── */}
          {sidebarOpen && (
            <aside className="w-72 flex-shrink-0 border-r-2 border-foreground bg-background overflow-hidden">
              <SidebarPanel
                history={history}
                onHistorySelect={handleHistorySelect}
                onHistoryClear={handleHistoryClear}
                selectedHistoryId={selectedHistoryId}
                pipelineItems={pipelineItems}
                onPipelineRemove={handlePipelineRemove}
                onPipelineClear={handlePipelineClear}
                highlightedPipelineId={highlightedPipelineId}
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
                            onClick={handleForge}
                            disabled={!canForge}
                            className="h-8 text-xs font-bold uppercase tracking-wide bg-primary text-primary-foreground border-2 border-foreground hover:bg-primary/90"
                          >
                            {loading ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Forging
                              </>
                            ) : (
                              <>
                                <Zap className="w-3.5 h-3.5 mr-1.5" />
                                Forge
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
                              onClick={handleForge}
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
                        <p className="text-xs font-bold uppercase tracking-wide">Forge Agent</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">{FORGE_AGENT_ID}</p>
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

                      {/* Section 4: Confidence Score */}
                      <ConfidenceBar score={confidenceScore} loading={loading} />

                      {/* Section 5: Diagnostic Note */}
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

                      {/* ─── ROUTE SELECTOR (after output exists) ──────────── */}
                      {output && !loading && (
                        <>
                          <div className="border-t-2 border-foreground my-4" />
                          <RouteSelector selectedRoute={selectedRoute} onSelect={handleRouteSelect} />

                          {/* ─── SEND TO PIPELINE BUTTON ─────────────────────── */}
                          <div className="space-y-3">
                            <Button
                              size="sm"
                              onClick={handleSendToPipeline}
                              disabled={!canSendToPipeline}
                              className={cn(
                                'w-full h-10 text-xs font-bold uppercase tracking-widest border-2 border-foreground',
                                canSendToPipeline
                                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              <Send className="w-3.5 h-3.5 mr-2" />
                              Send to Pipeline
                              {selectedRoute && (
                                <span className="ml-2 opacity-70">
                                  <ChevronRight className="w-3 h-3 inline" /> {selectedRoute.toUpperCase()}
                                </span>
                              )}
                            </Button>

                            {/* Pipeline status message */}
                            {pipelineMessage && (
                              <div className="p-3 border-2 border-secondary bg-secondary/10">
                                <div className="flex items-center gap-2">
                                  <Check className="w-4 h-4 text-secondary flex-shrink-0" />
                                  <p className="text-xs font-bold uppercase tracking-wide text-secondary">{pipelineMessage}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
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
