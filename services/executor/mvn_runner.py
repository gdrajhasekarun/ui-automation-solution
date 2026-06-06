import asyncio
import logging
import httpx

logger = logging.getLogger("executor.mvn")


async def _notify(dashboard_url: str, app_id: str, message: str):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{dashboard_url}/api/events", json={
                "app_id": app_id, "stage": "EXECUTE", "message": message, "level": "INFO"
            })
    except Exception:
        pass


async def run(java_dir: str, run_id: str, app_id: str, dashboard_url: str) -> dict:
    testng_file = f"{java_dir}/testng.xml"
    testdata_file = f"{java_dir}/src/test/resources/testdata.xlsx"

    proc = await asyncio.create_subprocess_exec(
        "mvn", "test",
        f"-Dsurefire.suiteXmlFiles={testng_file}",
        f"-Dtestdata.path={testdata_file}",
        cwd=java_dir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT
    )

    keywords = ["TEST", "PASS", "FAIL", "ERROR", "BUILD", "Tests run"]
    async for line in proc.stdout:
        line_str = line.decode(errors="replace").strip()
        if any(k in line_str for k in keywords):
            logger.info(f"[mvn] {line_str}")
            await _notify(dashboard_url, app_id, f"[mvn] {line_str}")

    await proc.wait()
    return {"exit_code": proc.returncode}
