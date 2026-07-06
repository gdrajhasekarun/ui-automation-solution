import logging
from typing import TYPE_CHECKING

from playwright.async_api import Page, Locator as PwLocator

from .locator import Locator
from ..utils.selector_registry import SelectorRegistry

logger = logging.getLogger(__name__)


class BasePage:
    def __init__(self, page: Page) -> None:
        self._page = page

    async def wait_for_ready(self) -> None:
        await self._page.wait_for_load_state("domcontentloaded")
        try:
            await self._page.wait_for_load_state("networkidle")
        except Exception:
            pass

    async def click(self, locator: Locator) -> None:
        el = await self._find_element(locator)
        await el.scroll_into_view_if_needed()
        try:
            await el.click()
        except Exception:
            await self._page.evaluate("el => el.click()", await el.element_handle())

    async def fill(self, locator: Locator, value: str) -> None:
        el = await self._find_element(locator)
        await el.fill("")
        await el.fill(value)

    async def select_option(self, locator: Locator, value: str) -> None:
        el = await self._find_element(locator)
        await el.select_option(value)

    async def assert_visible(self, locator: Locator) -> None:
        el = await self._find_element(locator)
        visible = await el.is_visible()
        if not visible:
            title = await self._page.title()
            raise AssertionError(
                f"Expected element not visible: [{locator.selector_key}] on: {title}"
            )

    async def assert_page_loaded(self) -> "BasePage":
        await self.wait_for_ready()
        return self

    async def assert_title(self, expected: str) -> None:
        actual = await self._page.title()
        if expected not in actual:
            raise AssertionError(f"Expected title: [{expected}] got: [{actual}]")

    async def get_text(self, locator: Locator) -> str | None:
        el = await self._find_element(locator)
        return await el.text_content()

    async def get_current_url(self) -> str:
        return self._page.url

    async def _find_element(self, locator: Locator) -> PwLocator:
        selector_key = locator.selector_key
        primary = locator.playwright_selector
        el = self._page.locator(primary).first
        if await el.count() > 0:
            return el
        fallbacks = SelectorRegistry.get_fallbacks(selector_key)
        for fb in fallbacks:
            fb_sel = self._resolve_selector(fb)
            fb_el = self._page.locator(fb_sel).first
            if await fb_el.count() > 0:
                title = await self._page.title()
                logger.warning(
                    "Self-healing: [%s] not found, used fallback [%s] on page: %s",
                    selector_key, fb, title,
                )
                return fb_el
        title = await self._page.title()
        raise AssertionError(
            f"Element not found: [{selector_key}] and all {len(fallbacks)} fallback(s) failed. Page: {title}"
        )

    @staticmethod
    def _resolve_selector(sk: str) -> str:
        if not sk:
            return "*"
        if sk.startswith("xpath="):
            return sk
        if sk.startswith("#"):
            return sk
        if sk.startswith("[name='"):
            return sk
        if sk.startswith("data-testid="):
            return f"[data-testid='{sk[12:]}']"
        if sk.startswith("aria-label="):
            return f"[aria-label='{sk[11:]}']"
        return sk
