from pydantic import BaseModel
from typing import Optional


class EventBody(BaseModel):
    app_id: str
    stage: str
    message: str
    level: str = "INFO"


class CrawlTriggerBody(BaseModel):
    app_id: str
    app_url: str = ""
    build_id: str = ""
    trigger_type: str = "INITIAL"
    framework_dir: str = ""


class PlanRunBody(BaseModel):
    app_id: str
    tc_name: str
    description: str = ""
    java_dir: str = ""


class ExecuteRunBody(BaseModel):
    app_id: str
    run_id: str = ""
    java_dir: str = ""
    selected_tests: list[str] = []
    test_data: list[dict] = []


class ExecuteResultsBody(BaseModel):
    run_id: str
    results: list[dict] = []
    mvn_exit_code: int = 0
