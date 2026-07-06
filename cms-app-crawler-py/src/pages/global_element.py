from ..base.base_page import BasePage
from ..base.locator import Locator


class GlobalElement(BasePage):
    _MEDICARE_NAV = Locator("css", 'a[href*="medicare"]')
    _MEDICAID_NAV = Locator("css", 'a[href*="medicaid"]')
    _ABOUT_CMS    = Locator("css", 'a[href*="about-cms"]')
    _EMAIL_SIGNUP = Locator("css", 'input[type="email"]')

    async def click_medicare_nav(self) -> "GlobalElement":
        await self.click(self._MEDICARE_NAV)
        return self

    async def click_medicaid_nav(self) -> "GlobalElement":
        await self.click(self._MEDICAID_NAV)
        return self

    async def click_about_cms(self) -> "GlobalElement":
        await self.click(self._ABOUT_CMS)
        return self
