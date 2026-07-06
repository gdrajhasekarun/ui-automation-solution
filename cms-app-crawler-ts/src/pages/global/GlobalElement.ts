// AUTO-GENERATED — DO NOT EDIT
// Regenerate via POST /v2/trigger

import { Page } from '@playwright/test';
import { BasePage } from '../../base/BasePage';

export class GlobalElement extends BasePage {
    readonly global_here_s_how_you_know_button: import('@playwright/test').Locator;
    readonly global_about_cms_link: import('@playwright/test').Locator;
    readonly global_newsroom_link: import('@playwright/test').Locator;
    readonly global_data_research_link: import('@playwright/test').Locator;
    readonly global_medicare_button: import('@playwright/test').Locator;
    readonly global_medicaid_chip_button: import('@playwright/test').Locator;
    readonly global_marketplace_private_insurance_button: import('@playwright/test').Locator;
    readonly global_initiatives_button: import('@playwright/test').Locator;
    readonly global_training_education_button: import('@playwright/test').Locator;
    readonly global_medicare_gov_link: import('@playwright/test').Locator;
    readonly global_insurekidsnow_gov_link: import('@playwright/test').Locator;
    readonly global_medicaid_gov_link: import('@playwright/test').Locator;
    readonly global_enter_your_email_address_textbox: import('@playwright/test').Locator;
    readonly global_sign_up_button: import('@playwright/test').Locator;
    readonly global_healthcare_gov_link: import('@playwright/test').Locator;
    readonly global_hhs_gov_link: import('@playwright/test').Locator;
    readonly global_hhs_gov_open_link: import('@playwright/test').Locator;
    readonly global_careers_link: import('@playwright/test').Locator;
    readonly global_acronyms_link: import('@playwright/test').Locator;
    readonly global_archive_link: import('@playwright/test').Locator;
    readonly global_contacts_link: import('@playwright/test').Locator;
    readonly global_glossary_link: import('@playwright/test').Locator;
    readonly global_privacy_policy_link: import('@playwright/test').Locator;
    readonly global_plain_language_link: import('@playwright/test').Locator;
    readonly global_privacy_settings_link: import('@playwright/test').Locator;
    readonly global_nondiscrimination_accessibility_link: import('@playwright/test').Locator;
    readonly global_for_developers_link: import('@playwright/test').Locator;
    readonly global_vulnerability_disclosure_policy_link: import('@playwright/test').Locator;
    readonly global_freedom_of_information_act_link: import('@playwright/test').Locator;
    readonly global_no_fear_act_link: import('@playwright/test').Locator;
    readonly global_inspector_general_link: import('@playwright/test').Locator;
    readonly global_usa_gov_link: import('@playwright/test').Locator;
    readonly global_linkedin_link_link: import('@playwright/test').Locator;
    readonly global_youtube_link_link: import('@playwright/test').Locator;
    readonly global_facebook_link_link: import('@playwright/test').Locator;
    readonly global_twitter_link_link: import('@playwright/test').Locator;
    readonly global_rss_feed_link_link: import('@playwright/test').Locator;
    readonly global_pfs_look_up_tool_overview_cms_link: import('@playwright/test').Locator;
    readonly global_search_the_physician_fee_schedule_cms_link: import('@playwright/test').Locator;
    readonly global_cms_home_link: import('@playwright/test').Locator;
    readonly global_documentation_and_files_link: import('@playwright/test').Locator;
    readonly global_help_link: import('@playwright/test').Locator;
    readonly global_help_with_file_formats_and_plug_ins_link: import('@playwright/test').Locator;

    constructor(page: Page) {
        super(page);
        this.global_here_s_how_you_know_button = page.locator('xpath=//button[normalize-space(.)=\'Here\\\'s how you know\']');
        this.global_about_cms_link = page.locator('a[href=\"/about-cms\"]');
        this.global_newsroom_link = page.locator('a[href=\"/about-cms/contact/newsroom\"]');
        this.global_data_research_link = page.locator('a[href=\"/data-research\"]');
        this.global_medicare_button = page.locator('#Medicare');
        this.global_medicaid_chip_button = page.locator('#Medicaid/CHIP');
        this.global_marketplace_private_insurance_button = page.locator('#Marketplace & Private Insurance');
        this.global_initiatives_button = page.locator('#Initiatives');
        this.global_training_education_button = page.locator('#Training & Education');
        this.global_medicare_gov_link = page.locator('a[href=\"https://www.medicare.gov\"]');
        this.global_insurekidsnow_gov_link = page.locator('a[href=\"https://www.insurekidsnow.gov/\"]');
        this.global_medicaid_gov_link = page.locator('a[href=\"https://www.medicaid.gov\"]');
        this.global_enter_your_email_address_textbox = page.locator('[aria-label=\"Enter your email address:\"]');
        this.global_sign_up_button = page.locator('#email-submit');
        this.global_healthcare_gov_link = page.locator('a[href=\"https://www.healthcare.gov/\"]');
        this.global_hhs_gov_link = page.locator('a[href=\"https://www.hhs.gov/\"]');
        this.global_hhs_gov_open_link = page.locator('a[href=\"https://www.hhs.gov/open/index.html\"]');
        this.global_careers_link = page.locator('a[href=\"/about-cms/work-with-us/careers\"]');
        this.global_acronyms_link = page.locator('a[href=\"/acronyms\"]');
        this.global_archive_link = page.locator('a[href=\"/about-cms/web-policies-important-links/about-website/archive\"]');
        this.global_contacts_link = page.locator('a[href=\"/about-cms/contact/database\"]');
        this.global_glossary_link = page.locator('a[href=\"/glossary\"]');
        this.global_privacy_policy_link = page.locator('a[href=\"/about-cms/web-policies-important-links/web-policies/privacy\"]');
        this.global_plain_language_link = page.locator('a[href=\"https://www.medicare.gov/about-us/plain-writing\"]');
        this.global_privacy_settings_link = page.locator('xpath=//a[normalize-space(.)=\'Privacy Settings\']');
        this.global_nondiscrimination_accessibility_link = page.locator('a[href=\"/about-cms/web-policies-important-links/accessibility-nondiscrimination-disabilities-notice\"]');
        this.global_for_developers_link = page.locator('a[href=\"https://developer.cms.gov/\"]');
        this.global_vulnerability_disclosure_policy_link = page.locator('a[href=\"/about-cms/information-systems/privacy/vulnerability-disclosure-policy\"]');
        this.global_freedom_of_information_act_link = page.locator('a[href=\"https://www.cms.gov/freedom-information-act-foia-service-center\"]');
        this.global_no_fear_act_link = page.locator('a[href=\"/about-cms/web-policies-important-links/no-fear-act\"]');
        this.global_inspector_general_link = page.locator('a[href=\"https://www.oig.hhs.gov\"]');
        this.global_usa_gov_link = page.locator('a[href=\"https://www.usa.gov/\"]');
        this.global_linkedin_link_link = page.locator('a[href=\"https://www.linkedin.com/company/centers-for-medicare-&-medicaid-services/\"]');
        this.global_youtube_link_link = page.locator('a[href=\"https://www.youtube.com/user/CMSHHSgov\"]');
        this.global_facebook_link_link = page.locator('a[href=\"https://www.facebook.com/medicare\"]');
        this.global_twitter_link_link = page.locator('a[href=\"https://twitter.com/cmsgov\"]');
        this.global_rss_feed_link_link = page.locator('a[href=\"https://www.cms.gov/Outreach-and-Education/Outreach/CMSFeeds/index\"]');
        this.global_pfs_look_up_tool_overview_cms_link = page.locator('a[href=\"/medicare/physician-fee-schedule/search/overview\"]');
        this.global_search_the_physician_fee_schedule_cms_link = page.locator('a[href=\"/medicare/physician-fee-schedule/search\"]');
        this.global_cms_home_link = page.locator('a[href=\"/\"]');
        this.global_documentation_and_files_link = page.locator('a[href=\"/medicare/physician-fee-schedule/search/documentation\"]');
        this.global_help_link = page.locator('a[href=\"#main-wrapper\"]');
        this.global_help_with_file_formats_and_plug_ins_link = page.locator('a[href=\"/about-cms/web-policies-important-links/help\"]');
    }

    async globalHereSHowYouKnowButton(): Promise<void> { await this.global_here_s_how_you_know_button.click(); }
    async globalAboutCmsLink(): Promise<void> { await this.global_about_cms_link.click(); }
    async globalNewsroomLink(): Promise<void> { await this.global_newsroom_link.click(); }
    async globalDataResearchLink(): Promise<void> { await this.global_data_research_link.click(); }
    async globalMedicareButton(): Promise<void> { await this.global_medicare_button.click(); }
    async globalMedicaidChipButton(): Promise<void> { await this.global_medicaid_chip_button.click(); }
    async globalMarketplacePrivateInsuranceButton(): Promise<void> { await this.global_marketplace_private_insurance_button.click(); }
    async globalInitiativesButton(): Promise<void> { await this.global_initiatives_button.click(); }
    async globalTrainingEducationButton(): Promise<void> { await this.global_training_education_button.click(); }
    async globalMedicareGovLink(): Promise<void> { await this.global_medicare_gov_link.click(); }
    async globalInsurekidsnowGovLink(): Promise<void> { await this.global_insurekidsnow_gov_link.click(); }
    async globalMedicaidGovLink(): Promise<void> { await this.global_medicaid_gov_link.click(); }
    async globalEnterYourEmailAddressTextbox(value: string): Promise<void> { await this.global_enter_your_email_address_textbox.fill(value); }
    async globalSignUpButton(): Promise<void> { await this.global_sign_up_button.click(); }
    async globalHealthcareGovLink(): Promise<void> { await this.global_healthcare_gov_link.click(); }
    async globalHhsGovLink(): Promise<void> { await this.global_hhs_gov_link.click(); }
    async globalHhsGovOpenLink(): Promise<void> { await this.global_hhs_gov_open_link.click(); }
    async globalCareersLink(): Promise<void> { await this.global_careers_link.click(); }
    async globalAcronymsLink(): Promise<void> { await this.global_acronyms_link.click(); }
    async globalArchiveLink(): Promise<void> { await this.global_archive_link.click(); }
    async globalContactsLink(): Promise<void> { await this.global_contacts_link.click(); }
    async globalGlossaryLink(): Promise<void> { await this.global_glossary_link.click(); }
    async globalPrivacyPolicyLink(): Promise<void> { await this.global_privacy_policy_link.click(); }
    async globalPlainLanguageLink(): Promise<void> { await this.global_plain_language_link.click(); }
    async globalPrivacySettingsLink(): Promise<void> { await this.global_privacy_settings_link.click(); }
    async globalNondiscriminationAccessibilityLink(): Promise<void> { await this.global_nondiscrimination_accessibility_link.click(); }
    async globalForDevelopersLink(): Promise<void> { await this.global_for_developers_link.click(); }
    async globalVulnerabilityDisclosurePolicyLink(): Promise<void> { await this.global_vulnerability_disclosure_policy_link.click(); }
    async globalFreedomOfInformationActLink(): Promise<void> { await this.global_freedom_of_information_act_link.click(); }
    async globalNoFearActLink(): Promise<void> { await this.global_no_fear_act_link.click(); }
    async globalInspectorGeneralLink(): Promise<void> { await this.global_inspector_general_link.click(); }
    async globalUsaGovLink(): Promise<void> { await this.global_usa_gov_link.click(); }
    async globalLinkedinLinkLink(): Promise<void> { await this.global_linkedin_link_link.click(); }
    async globalYoutubeLinkLink(): Promise<void> { await this.global_youtube_link_link.click(); }
    async globalFacebookLinkLink(): Promise<void> { await this.global_facebook_link_link.click(); }
    async globalTwitterLinkLink(): Promise<void> { await this.global_twitter_link_link.click(); }
    async globalRssFeedLinkLink(): Promise<void> { await this.global_rss_feed_link_link.click(); }
    async globalPfsLookUpToolOverviewCmsLink(): Promise<void> { await this.global_pfs_look_up_tool_overview_cms_link.click(); }
    async globalSearchThePhysicianFeeScheduleCmsLink(): Promise<void> { await this.global_search_the_physician_fee_schedule_cms_link.click(); }
    async globalCmsHomeLink(): Promise<void> { await this.global_cms_home_link.click(); }
    async globalDocumentationAndFilesLink(): Promise<void> { await this.global_documentation_and_files_link.click(); }
    async globalHelpLink(): Promise<void> { await this.global_help_link.click(); }
    async globalHelpWithFileFormatsAndPlugInsLink(): Promise<void> { await this.global_help_with_file_formats_and_plug_ins_link.click(); }
}
