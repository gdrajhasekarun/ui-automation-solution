import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { UiEvent } from '../types'

// ── V2 request / response shapes ──────────────────────────────────────────────

export interface V2CrawlTriggerReq {
  app_id:        string
  app_url:       string
  excel_path:    string
  framework_dir: string
  max_pages?:    number
  max_depth?:    number
  headless?:     boolean
  target_flows?: string[]
}

export interface V2CrawlTriggerResp {
  run_id:        string
  crawl_job_id:  string
  status:        string
}

export interface V2JobStatus {
  status:      string   // STARTED | RUNNING | COMPLETE | FAILED
  app_id?:     string
  error?:      string
  totalNodes?: number
  totalEdges?: number
  [key: string]: unknown
}

export interface V2GraphElement {
  selectorKey:    string
  role:           string
  label:          string
  tag:            string
  isInteractable: boolean
  actionType:     string
  frameContext:   string | null
}

export interface V2GraphNode {
  nodeId:              string
  url:                 string
  title:               string
  type?:               string
  elements:            V2GraphElement[]
  assertableElements?: string[]
  className?:          string
}

export interface V2GraphEdge {
  edgeId:      string
  fromNodeId:  string
  toNodeId:    string
  selectorKey: string
  actionType:  string
  label:       string
  isLoop?:     boolean
}

export interface V2Graph {
  nodes: V2GraphNode[]
  edges: V2GraphEdge[]
  meta:  {
    appId:       string
    crawledAt:   string
    totalNodes:  number
    totalEdges:  number
    source?:     string
  }
}

export interface V2ServiceHealth {
  status:          string
  deployment_type?: string
  engine?:          string
  port?:            number
  detail?:          string
}

// ── RTK Query API ─────────────────────────────────────────────────────────────

export const apiV2 = createApi({
  reducerPath: 'apiV2',
  baseQuery: fetchBaseQuery({ baseUrl: '/api/v2' }),
  tagTypes: ['V2Graph', 'V2Events'],
  endpoints: (build) => ({

    v2TriggerCrawl: build.mutation<V2CrawlTriggerResp, V2CrawlTriggerReq>({
      query: (body) => ({ url: '/crawl/trigger', method: 'POST', body }),
    }),

    v2GetJobStatus: build.query<V2JobStatus, string>({
      query: (jobId) => `/crawl/status/${encodeURIComponent(jobId)}`,
    }),

    v2GetCrawlHealth: build.query<V2ServiceHealth, void>({
      query: () => '/crawl/health',
    }),

    v2GetGraph: build.query<V2Graph, string>({
      query: (appId) => `/graph/${encodeURIComponent(appId)}`,
      providesTags: ['V2Graph'],
    }),

    v2GetEvents: build.query<UiEvent[], { appId: string; limit?: number; since?: string }>({
      query: ({ appId, limit = 300, since }) =>
        `/events/${encodeURIComponent(appId)}?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ''}`,
      transformResponse: (raw: unknown) => {
        const arr = Array.isArray(raw) ? raw : ((raw as { events?: UiEvent[] }).events ?? [])
        return [...arr].sort((a, b) =>
          String(b.created_at ?? b.timestamp ?? '').localeCompare(String(a.created_at ?? a.timestamp ?? ''))
        )
      },
      providesTags: ['V2Events'],
    }),

  }),
})

export const {
  useV2TriggerCrawlMutation,
  useV2GetJobStatusQuery,
  useV2GetCrawlHealthQuery,
  useV2GetGraphQuery,
  useV2GetEventsQuery,
} = apiV2
