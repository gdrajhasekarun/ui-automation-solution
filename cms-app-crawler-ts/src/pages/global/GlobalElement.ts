import { BasePage } from '../../base/BasePage';
import { Locator } from '../../base/Locator';

export class GlobalElement extends BasePage {
  protected static readonly MEDICARE_NAV = new Locator('css', 'a[href*="medicare"]');
  protected static readonly MEDICAID_NAV = new Locator('css', 'a[href*="medicaid"]');
  protected static readonly ABOUT_CMS    = new Locator('css', 'a[href*="about-cms"]');
  protected static readonly EMAIL_SIGNUP = new Locator('css', 'input[type="email"]');

  async clickMedicareNav(): Promise<this> {
    await this.click(GlobalElement.MEDICARE_NAV);
    return this;
  }

  async clickMedicaidNav(): Promise<this> {
    await this.click(GlobalElement.MEDICAID_NAV);
    return this;
  }

  async clickAboutCms(): Promise<this> {
    await this.click(GlobalElement.ABOUT_CMS);
    return this;
  }
}
