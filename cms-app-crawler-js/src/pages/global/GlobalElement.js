'use strict';

const { BasePage } = require('../../base/BasePage');
const { Locator } = require('../../base/Locator');

class GlobalElement extends BasePage {
  static MEDICARE_NAV   = new Locator('css', 'a[href*="medicare"]');
  static MEDICAID_NAV   = new Locator('css', 'a[href*="medicaid"]');
  static ABOUT_CMS      = new Locator('css', 'a[href*="about-cms"]');
  static EMAIL_SIGNUP   = new Locator('css', 'input[type="email"]');

  async clickMedicareNav() {
    await this.click(GlobalElement.MEDICARE_NAV);
    return this;
  }

  async clickMedicaidNav() {
    await this.click(GlobalElement.MEDICAID_NAV);
    return this;
  }

  async clickAboutCms() {
    await this.click(GlobalElement.ABOUT_CMS);
    return this;
  }
}

module.exports = { GlobalElement };
