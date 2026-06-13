import os

CRAWL_URL          = os.environ.get("CRAWL_URL",          "http://localhost:8001")
CRAWL_AI_URL       = os.environ.get("CRAWL_AI_URL",       "http://localhost:8006")
GRAPH_CRAWLER_URL  = os.environ.get("GRAPH_CRAWLER_URL",  "http://localhost:8005")
GENERATOR_URL = os.environ.get("GENERATOR_URL", "http://localhost:8002")
PLANNER_URL   = os.environ.get("PLANNER_URL",   "http://localhost:8003")
EXECUTOR_URL  = os.environ.get("EXECUTOR_URL",  "http://localhost:8004")
PORT          = 8000
