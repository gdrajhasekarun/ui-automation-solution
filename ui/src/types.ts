export interface TestCase {
  tc_id: string
  app_id: string
  tc_name: string
  status: 'PLANNED' | 'READY' | 'NEEDS_REVIEW' | 'PASSED' | 'FAILED'
  confidence: number
  file_path: string
  class_name: string
  method_name: string
  parameters: Parameter[]
  review_reason: string
  last_run?: string
  created_at: string
  updated_at: string
}

export interface Parameter {
  name: string
  type: string
}

export interface UiEvent {
  event_id?: string
  id?: string
  app_id: string
  stage: string
  message: string
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'
  created_at?: string
  timestamp?: string
}

export interface ServiceHealth {
  service?: string
  status: string
  deployment_type?: string
  port?: number
  active_runs?: number
}

export interface TestResult {
  result_id?: string
  run_id?: string
  tc_name: string
  test_name?: string
  status: 'PASSED' | 'FAILED' | 'SKIPPED'
  duration_ms?: number
  duration?: number
  failure_msg?: string
  failure?: string
  error?: string
  created_at?: string
}

export interface StoryInterpretReq {
  user_story: string
  app_url: string
}

export interface StoryHint {
  field: string
  value: string
}

export interface StoryInterpretResp {
  flow_name?: string
  goal?: string
  hints?: StoryHint[]
  seed_url?: string
  error?: string
}

export interface TestRun {
  run_id?: string
  id?: string
  app_id?: string
  status?: string
  total_duration?: number
  duration_ms?: number
  results?: TestResult[]
  test_results?: TestResult[]
  created_at?: string
  started_at?: string
}

export interface RawTestCase {
  tc_name?: string
  name?: string
  description?: string
}

export interface PlanResult {
  steps?: PlanStep[]
  plan_steps?: PlanStep[]
  parameters?: Parameter[]
  params?: Parameter[]
  confidence?: number
  score?: number
  class_name?: string
  review_reason?: string
}

export interface PlanStep {
  page_class?: string
  method?: string
  action?: string
  params?: string[]
  parameters?: string[]
}
