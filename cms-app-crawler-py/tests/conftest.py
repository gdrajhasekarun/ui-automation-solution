import os
import pytest
from playwright.async_api import async_playwright, Browser, Page


@pytest.fixture(scope="session")
async def browser():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True)
        yield b
        await b.close()


@pytest.fixture
async def page(browser: Browser) -> Page:
    context = await browser.new_context()
    pg = await context.new_page()
    app_url = os.environ.get("APP_URL", "")
    if app_url:
        await pg.goto(app_url)
    yield pg
    await context.close()
