'use strict';

const { SelectorRegistry } = require('../utils/SelectorRegistry');

class BasePage {
  constructor(page) {
    this._page = page;
  }

  async waitForReady() {
    await this._page.waitForLoadState('domcontentloaded');
    await this._page.waitForLoadState('networkidle').catch(() => {});
  }

  async click(locator) {
    const el = await this._findElement(locator);
    await el.scrollIntoViewIfNeeded();
    try {
      await el.click();
    } catch (e) {
      await this._page.evaluate(el => el.click(), await el.elementHandle());
    }
  }

  async fill(locator, value) {
    const el = await this._findElement(locator);
    await el.fill('');
    await el.fill(value);
  }

  async selectOption(locator, value) {
    const el = await this._findElement(locator);
    await el.selectOption(value);
  }

  async assertVisible(locator) {
    const el = await this._findElement(locator);
    const visible = await el.isVisible();
    if (!visible) {
      throw new Error(`Expected element not visible: [${locator.getSelectorKey()}] on: ${await this._page.title()}`);
    }
  }

  async assertPageLoaded() {
    await this.waitForReady();
    return this;
  }

  async assertTitle(expected) {
    const actual = await this._page.title();
    if (!actual.includes(expected)) {
      throw new Error(`Expected title: [${expected}] got: [${actual}]`);
    }
  }

  async getText(locator) {
    const el = await this._findElement(locator);
    return el.textContent();
  }

  async getCurrentUrl() {
    return this._page.url();
  }

  async _findElement(locator) {
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

  _resolveSelector(sk) {
    if (!sk) return '*';
    if (sk.startsWith('xpath='))       return sk;
    if (sk.startsWith('#'))            return sk;
    if (sk.startsWith("[name='"))      return sk;
    if (sk.startsWith('data-testid=')) return `[data-testid='${sk.substring(12)}']`;
    if (sk.startsWith('aria-label='))  return `[aria-label='${sk.substring(11)}']`;
    return sk;
  }
}

module.exports = { BasePage };
