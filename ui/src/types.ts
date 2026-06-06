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
  created_at: string
  updated_at: string
}

export interface Parameter {
  name: string
  type: string
}

export interface UiEvent {
  event_id: string
  app_id: string
  stage: string
  message: string
  level: 'INFO' | 'WARN' | 'ERROR'
  created_at: string
}

export interface ServiceHealth {
  service?: string
  status: string
  deployment_type?: string
  port?: number
  active_runs?: number
}

export interface TestResult {
  result_id: string
  run_id: string
  tc_name: string
  status: 'PASSED' | 'FAILED' | 'SKIPPED'
  duration_ms: number
  failure_msg: string
  created_at: string
}
