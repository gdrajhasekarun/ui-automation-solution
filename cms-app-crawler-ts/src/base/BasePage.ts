import type { Page, Locator as PwLocator } from 'playwright';
import { Locator } from './Locator';
import { SelectorRegistry } from '../utils/SelectorRegistry';

export abstract class BasePage {
  protected readonly _page: Page;

  constructor(page: Page) {
    this._page = page;
  }

  async waitForReady(): Promise<void> {
    await this._page.waitForLoadState('domcontentloaded');
    await this._page.waitForLoadState('networkidle').catch(() => {});
  }

  async click(locator: Locator): Promise<void> {
    const el = await this._findElement(locator);
    await el.scrollIntoViewIfNeeded();
    try {
      await el.click();
    } catch {
      await this._page.evaluate((el) => (el as HTMLElement).click(), await el.elementHandle());
    }
  }

  async fill(locator: Locator, value: string): Promise<void> {
    const el = await this._findElement(locator);
    await el.fill('');
    await el.fill(value);
  }

  async selectOption(locator: Locator, value: string): Promise<void> {
    const el = await this._findElement(locator);
    await el.selectOption(value);
  }

  async assertVisible(locator: Locator): Promise<void> {
    const el = await this._findElement(locator);
    const visible = await el.isVisible();
    if (!visible) {
      throw new Error(`Expected element not visible: [${locator.getSelectorKey()}] on: ${await this._page.title()}`);
    }
  }

  async assertPageLoaded(): Promise<this> {
    await this.waitForReady();
    return this;
  }

  async assertTitle(expected: string): Promise<void> {
    const actual = await this._page.title();
    if (!actual.includes(expected)) {
      throw new Error(`Expected title: [${expected}] got: [${actual}]`);
    }
  }

  async getText(locator: Locator): Promise<string | null> {
    const el = await this._findElement(locator);
    return el.textContent();
  }

  async getCurrentUrl(): Promise<string> {
    return this._page.url();
  }

  protected async _findElement(locator: Locator): Promise<PwLocator> {
    const selectorKey = locator.getSelectorKey();
    const primary = locator.toPlaywrightSelector();
    const el = this._page.locator(primary).first();
    if (await el.count() > 0) {
      return el;
    }
    const fallbacks = SelectorRegistry.getFallbacks(selectorKey);
    for (const fb of fallbacks) {
      const fbSel = this._resolveSelector(fb);
      const fbEl = this._page.locator(fbSel).first();
      if (await fbEl.count() > 0) {
        console.warn(`Self-healing: [${selectorKey}] not found, used fallback [${fb}] on page: ${await this._page.title()}`);
        return fbEl;
      }
    }
    throw new Error(`Element not found: [${selectorKey}] and all ${fallbacks.length} fallback(s) failed. Page: ${await this._page.title()}`);
  }

  private _resolveSelector(sk: string): string {
    if (!sk) return '*';
    if (sk.startsWith('xpath='))       return sk;
    if (sk.startsWith('#'))            return sk;
    if (sk.startsWith("[name='"))      return sk;
    if (sk.startsWith('data-testid=')) return `[data-testid='${sk.substring(12)}']`;
    if (sk.startsWith('aria-label='))  return `[aria-label='${sk.substring(11)}']`;
    return sk;
  }
}
