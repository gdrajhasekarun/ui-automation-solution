import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { UiEvent, StoryInterpretReq, StoryInterpretResp } from '../types'

// ── V3 request / response shapes ──────────────────────────────────────────────

export type TargetTool = 'selenium-java' | 'selenium-csharp' | 'playwright-js' | 'playwright-ts'

export interface V3CrawlTriggerReq {
  app_id:         string
  app_url:        string
  excel_path?:    string
  framework_dir?: string
  target_tool?:   TargetTool
  max_pages?:     number
  max_depth?:     number
  headless?:      boolean
  // V3-specific
  config_path?:    string
  allowed_domain?: string
  llm_enabled?:    boolean
  target_flows?:   string[]
}

export interface V3CrawlTriggerResp {
  run_id:       string
  crawl_job_id: string
  status:       string
}

export interface V3JobStatus {
  status:                      string   // STARTED | RUNNING | COMPLETE | FAILED
  app_id?:                     string
  seed_url?:                   string
  started_at?:                 string
  finished_at?:                string
  node_count?:                 number
  edge_count?:                 number
  unfilled_fields?:            number
  output_files?:               string[]
  summary?:                    string
  error?:                      string
  eval_score?:                 number
  eval_grade?:                 string
  spec_quality_recommendation?: string
  [key: string]:               unknown
}

export interface V3GraphElement {
  role:            string
  name:            string | null
  tag:             string
  type:            string | null
  visible:         boolean | null
  isInteractable:  boolean
  actionType:      string
  nearestHeading:  string | null
}

export interface V3GraphNode {
  url:            string
  normalizedUrl:  string
  title:          string
  fingerprint:    string
  elements:       V3GraphElement[]
  unfilledFields: { selector: string; type: string; label: string | null }[]
}

export interface V3GraphEdge {
  id:   string
  from: string
  to:   string
  trigger: {
    type:         string
    semanticType: string | null
    elementRole:  string | null
    elementName:  string | null
    formFields?:  string[]
  }
}

export interface V3Graph {
  meta: {
    crawledAt:      string
    seedUrl:        string
    accountId?:     string
    accountRole?:   string
    totalNodes:     number
    totalEdges:     number
    unfilledFields: number
    summary?:       string
    aliases?:       Record<string, string>
  }
  nodes: Record<string, V3GraphNode>
  edges: V3GraphEdge[]
}

export interface V3ServiceHealth {
  service?:         string
  status:           string
  deployment_type?: string
  port?:            number
  active_jobs?:     number
  detail?:          string
}

// ── V3-AI request shape (crawl-ai Node.js service) ────────────────────────────

export interface V3AiCrawlTriggerReq {
  app_id:          string
  app_url?:        string
  excel_path?:     string
  framework_dir?:  string
  target_tool?:    TargetTool
  max_pages?:      number
  max_depth?:      number
  headless?:       boolean
  target_flows?:   string[]
  allowed_domain?: string
  llm_enabled?:    boolean
}

// ── RTK Query API ─────────────────────────────────────────────────────────────

export const apiV3 = createApi({
  reducerPath: 'apiV3',
  baseQuery: fetchBaseQuery({ baseUrl: '/api/v3' }),
  tagTypes: ['V3Graph', 'V3Events', 'V3AiGraph', 'V3AiEvents'],
  endpoints: (build) => ({

    // ── Graph Crawler (app-graph-crawler, port 8005) ───────────────────────────

    v3TriggerCrawl: build.mutation<V3CrawlTriggerResp, V3CrawlTriggerReq>({
      query: (body) => ({ url: '/crawl/trigger', method: 'POST', body }),
    }),

    v3GetJobStatus: build.query<V3JobStatus, string>({
      query: (jobId) => `/crawl/status/${encodeURIComponent(jobId)}`,
    }),

    v3GetCrawlHealth: build.query<V3ServiceHealth, void>({
      query: () => '/crawl/health',
    }),

    v3GetGraph: build.query<V3Graph, string>({
      query: (appId) => `/graph/${encodeURIComponent(appId)}`,
      providesTags: ['V3Graph'],
    }),

    v3GetEvents: build.query<UiEvent[], { appId: string; limit?: number; since?: string }>({
      query: ({ appId, limit = 300, since }) =>
        `/events/${encodeURIComponent(appId)}?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ''}`,
      transformResponse: (raw: unknown) => {
        const arr = Array.isArray(raw) ? raw : ((raw as { events?: UiEvent[] }).events ?? [])
        return [...arr].sort((a, b) =>
          String(b.created_at ?? b.timestamp ?? '').localeCompare(String(a.created_at ?? a.timestamp ?? ''))
        )
      },
      providesTags: ['V3Events'],
    }),

    // ── Crawl AI (crawl-ai Node.js service, port 8006) ────────────────────────

    v3AiTriggerCrawl: build.mutation<V3CrawlTriggerResp, V3AiCrawlTriggerReq>({
      query: (body) => ({ url: '/ai/crawl/trigger', method: 'POST', body }),
    }),

    v3AiGetJobStatus: build.query<V3JobStatus, string>({
      query: (jobId) => `/ai/crawl/status/${encodeURIComponent(jobId)}`,
    }),

    v3AiGetCrawlHealth: build.query<V3ServiceHealth, void>({
      query: () => '/ai/crawl/health',
    }),

    v3AiGetGraph: build.query<V3Graph, string>({
      query: (appId) => `/ai/graph/${encodeURIComponent(appId)}`,
      providesTags: ['V3AiGraph'],
    }),

    v3AiGetEvents: build.query<UiEvent[], { appId: string; limit?: number; since?: string }>({
      query: ({ appId, limit = 300, since }) =>
        `/ai/events/${encodeURIComponent(appId)}?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ''}`,
      transformResponse: (raw: unknown) => {
        const arr = Array.isArray(raw) ? raw : ((raw as { events?: UiEvent[] }).events ?? [])
        return [...arr].sort((a, b) =>
          String(b.created_at ?? b.timestamp ?? '').localeCompare(String(a.created_at ?? a.timestamp ?? ''))
        )
      },
      providesTags: ['V3AiEvents'],
    }),

    interpretStory: build.mutation<StoryInterpretResp, StoryInterpretReq>({
      query: (body) => ({ url: '/story/interpret', method: 'POST', body }),
    }),

  }),
})

export const {
  useV3TriggerCrawlMutation,
  useV3GetJobStatusQuery,
  useV3GetCrawlHealthQuery,
  useV3GetGraphQuery,
  useV3GetEventsQuery,
  useV3AiTriggerCrawlMutation,
  useV3AiGetJobStatusQuery,
  useV3AiGetCrawlHealthQuery,
  useV3AiGetGraphQuery,
  useV3AiGetEventsQuery,
  useInterpretStoryMutation,
} = apiV3
