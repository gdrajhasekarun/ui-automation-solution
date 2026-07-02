import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { TestCase, TestResult, TestRun, UiEvent, Parameter } from '../types'

// ── Request / response shapes ─────────────────────────────────────────────────

export interface CrawlTriggerReq {
  app_id:                    string
  app_url:                   string
  build_id:                  string
  trigger_type:              'INITIAL' | 'UPDATE'
  framework_dir?:            string
  global_filter_threshold?:  number   // 0.0–1.0, fraction of pages an element must appear on to be filtered as global nav
  flow_name?:                string   // focused flow intent — drives crawler's flowName for re-crawl
  headless?:                 boolean
}

export interface LoadExcelReq  { excel_path: string }
export interface LoadExcelResp { test_cases: { tc_name: string; name?: string; description?: string }[] }

export interface PlanRunReq {
  app_id:      string
  tc_name:     string
  description: string
  java_dir:    string
  steps?:      import('../types').RawTestCaseStep[]
}

export interface SavePlanReq {
  app_id:      string
  java_dir:    string
  test_cases:  { tc_name: string; result: unknown }[]
}

export interface ExecuteRunReq {
  app_id:         string
  run_id:         string
  java_dir:       string
  selected_tests: string[]
  test_data:      { tc_name: string; values: Record<string, string> }[]
}

export interface RunResultsResp {
  status?:          string
  results?:         TestResult[]
  test_results?:    TestResult[]
  total_duration?:  number
  duration_ms?:     number
}

export interface RunsResp {
  runs?: TestRun[]
}

// ── API ───────────────────────────────────────────────────────────────────────

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/dashboard/api' }),
  tagTypes: ['TestCases', 'Events', 'Runs'],
  endpoints: (build) => ({

    // Knowledge Base
    triggerCrawl: build.mutation<unknown, CrawlTriggerReq>({
      query: (body) => ({ url: '/crawl/trigger', method: 'POST', body }),
    }),

    getGraph: build.query<{ nodes: unknown[] | Record<string, unknown>; edges: unknown[]; globalElements?: Record<string, unknown>; meta: unknown }, string>({
      query: (appId) => `/graph/${encodeURIComponent(appId)}`,
    }),

    getEvents: build.query<UiEvent[], { appId: string; limit?: number; since?: string }>({
      query: ({ appId, limit = 200, since }) =>
        `/events/${encodeURIComponent(appId)}?limit=${limit}${since ? `&since=${encodeURIComponent(since)}` : ''}`,
      transformResponse: (raw: unknown) => {
        const arr = Array.isArray(raw) ? raw : ((raw as { events?: UiEvent[] }).events ?? [])
        // newest first
        return [...arr].sort((a, b) =>
          String(b.created_at ?? b.timestamp ?? '').localeCompare(String(a.created_at ?? a.timestamp ?? ''))
        )
      },
      providesTags: ['Events'],
    }),

    // Test Design
    loadExcel: build.mutation<LoadExcelResp, LoadExcelReq>({
      query: (body) => ({ url: '/plan/load-excel', method: 'POST', body }),
    }),

    planRun: build.mutation<{ job_id?: string; tc_id?: string; status?: string }, PlanRunReq>({
      query: (body) => ({ url: '/plan/run', method: 'POST', body }),
      invalidatesTags: ['TestCases'],
    }),

    getPlanStatus: build.query<{ status: string; steps?: unknown[]; confidence?: number; parameters?: unknown[]; review_reason?: string; class_name?: string; method_name?: string }, string>({
      query: (jobId) => `/plan/status/${encodeURIComponent(jobId)}`,
    }),

    savePlan: build.mutation<unknown, SavePlanReq>({
      query: (body) => ({ url: '/plan/save', method: 'POST', body }),
      invalidatesTags: ['TestCases'],
    }),

    // Execution
    getTestCases: build.query<TestCase[], string>({
      query: (appId) => `/test-cases/${encodeURIComponent(appId)}`,
      transformResponse: (raw: unknown) =>
        Array.isArray(raw) ? raw : ((raw as { test_cases?: TestCase[] }).test_cases ?? []),
      providesTags: ['TestCases'],
    }),

    getTestCaseParams: build.query<Parameter[], string>({
      query: (tcId) => `/test-cases/${encodeURIComponent(tcId)}/parameters`,
      transformResponse: (raw: unknown) =>
        Array.isArray(raw) ? raw : ((raw as { parameters?: Parameter[] }).parameters ?? []),
    }),

    executeRun: build.mutation<unknown, ExecuteRunReq>({
      query: (body) => ({ url: '/execute/run', method: 'POST', body }),
      invalidatesTags: ['TestCases'],
    }),

    getRunResults: build.query<RunResultsResp, string>({
      query: (runId) => `/run/${encodeURIComponent(runId)}/results`,
    }),

    getRuns: build.query<TestRun[], string>({
      query: (appId) => `/runs/${encodeURIComponent(appId)}`,
      transformResponse: (raw: unknown) => {
        const arr: TestRun[] = Array.isArray(raw) ? raw : ((raw as { runs?: TestRun[] }).runs ?? [])
        return [...arr].sort((a, b) =>
          String(b.created_at ?? b.started_at ?? '').localeCompare(String(a.created_at ?? a.started_at ?? ''))
        )
      },
      providesTags: ['Runs'],
    }),

  }),
})

export const {
  useTriggerCrawlMutation,
  useGetEventsQuery,
  useLazyGetEventsQuery,
  useGetGraphQuery,
  useLoadExcelMutation,
  usePlanRunMutation,
  useSavePlanMutation,
  useGetTestCasesQuery,
  useGetTestCaseParamsQuery,
  useExecuteRunMutation,
  useGetRunResultsQuery,
  useGetRunsQuery,
  useLazyGetPlanStatusQuery,
} = api
