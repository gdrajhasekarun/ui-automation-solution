// AUTO-GENERATED — DO NOT EDIT
// Regenerate via POST /trigger

package pages;

import base.BasePage;
import base.Locator;
import org.openqa.selenium.WebDriver;

public class MolinaHealthcareOfArizonaPage extends BasePage {

    private static final Locator A_HREF_MEMBERS_COMMON_EN_US = new Locator("css", "a[href='/members/common/en-US/terms_privacy.aspx']");
    private static final Locator A_HREF_MAIN_CONTENT = new Locator("css", "a[href='#main-content']");
    private static final Locator IMAGE = new Locator("id", "image");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_2 = new Locator("css", "a[href='/members/common/en-US/sitemap.aspx']");
    private static final Locator A_HREF_HTTPS_MEMBER_MOLINAHEALTHCARE_COM = new Locator("css", "a[href='https://member.molinahealthcare.com/Member/Login']");
    private static final Locator A_HREF_HTTPS_WWW_AVAILITY_COM = new Locator("css", "a[href='https://www.availity.com/molinahealthcare/']");
    private static final Locator REGISTERURL = new Locator("id", "registerURL");
    private static final Locator A_HREF_MEMBERS_AZ_EN_US = new Locator("css", "a[href='/members/az/en-US/pages/home.aspx']");
    private static final Locator ENROLLMENTANDRENEWAL_NAV = new Locator("id", "EnrollmentandRenewal-nav");
    private static final Locator A_HREF_MEMBERS_AZ_EN_US_2 = new Locator("css", "a[href='/members/az/en-us/hp/medicaid/overvw/overvw.aspx']");
    private static final Locator A_HREF_MEMBERS_AZ_EN_US_3 = new Locator("css", "a[href='/members/az/en-us/hp/medicare/medicare.aspx']");
    private static final Locator MEMBERS_NAV = new Locator("id", "Members-nav");
    private static final Locator A_HREF_MEMBERS_AZ_EN_US_4 = new Locator("css", "a[href='/members/az/en-us/mem/medicaid/medicaid.aspx']");
    private static final Locator A_HREF_MEMBERS_AZ_EN_US_5 = new Locator("css", "a[href='/members/az/en-us/mem/medicare/medicare.aspx']");
    private static final Locator A_HREF_MEMBERS_AZ_EN_US_6 = new Locator("css", "a[href='/members/az/en-us/mem/hipaa/home.aspx']");
    private static final Locator A_HREF_HTTPS_MEMBER_MOLINAHEALTHCARE_COM_2 = new Locator("css", "a[href='https://member.molinahealthcare.com/']");
    private static final Locator A_HREF_HTTP_WWW_MOLINAHELPFINDER_COM = new Locator("css", "a[href='http://www.molinahelpfinder.com/']");
    private static final Locator A_HREF_MEMBERS_AZ_EN_US_7 = new Locator("css", "a[href='/members/az/en-us/mem/member-rewards.aspx']");
    private static final Locator HEALTHCAREPROFESSIONALS_NAV = new Locator("id", "HealthCareProfessionals-nav");
    private static final Locator A_HREF_PROVIDERS_AZ_MEDICAID_HOME = new Locator("css", "a[href='/providers/az/medicaid/home.aspx']");
    private static final Locator A_HREF_PROVIDERS_COMMON_MEDICARE_MEDICARE = new Locator("css", "a[href='/providers/common/medicare/medicare']");
    private static final Locator A_HREF_HTTPS_WWW_AVAILITY_COM_2 = new Locator("css", "a[href='https://www.availity.com/molinahealthcare']");
    private static final Locator A_HREF_HTTPS_MOLINA_SAPPHIRETHREESIXTYFIVE_COM = new Locator("css", "a[href='https://molina.sapphirethreesixtyfive.com//?ci=az-molina']");
    private static final Locator BROKERS_NAV = new Locator("id", "Brokers-nav");
    private static final Locator A_HREF_HTTPS_WWW_MOLINAMARKETPLACE_COM = new Locator("css", "a[href='https://www.molinamarketplace.com/marketplace/brokers/en-us/']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_3 = new Locator("css", "a[href='/members/common/en-us/brokers/medicare']");
    private static final Locator ABOUTMOLINA_NAV = new Locator("id", "AboutMolina-nav");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_4 = new Locator("css", "a[href='/members/common/en-us/abtmolina/compinfo/compinfo.aspx']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_5 = new Locator("css", "a[href='/members/common/en-us/abtmolina/community/community.aspx']");
    private static final Locator A_HREF_BLOG_PAGES_HOME_ASPX = new Locator("css", "a[href='/blog/pages/home.aspx?state=Arizona']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_6 = new Locator("css", "a[href='/members/common/en-us/healthy/home.aspx']");
    private static final Locator A_HREF_HTTPS_CAREERS_MOLINAHEALTHCARE_COM = new Locator("css", "a[href='https://careers.molinahealthcare.com/']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_7 = new Locator("css", "a[href='/members/common/en-us/abtmolina/compinfo/aboutus.aspx']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_8 = new Locator("css", "a[href='/members/common/en-us/abtmolina/compinfo/mission.aspx']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_9 = new Locator("css", "a[href='/members/common/en-us/abtmolina/compinfo/mhp.aspx']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_10 = new Locator("css", "a[href='/members/common/en-us/abtmolina/compinfo/mhp-OD.aspx']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_11 = new Locator("css", "a[href='/members/common/en-us/abtmolina/compinfo/newsmed/newsmed.aspx']");
    private static final Locator A_HREF_HTTPS_INVESTORS_MOLINAHEALTHCARE_COM = new Locator("css", "a[href='https://investors.molinahealthcare.com/']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_12 = new Locator("css", "a[href='/members/common/en-us/abtmolina/compinfo/quality/quality.aspx']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_13 = new Locator("css", "a[href='/members/common/en-us/abtmolina/community/corpsoc.aspx']");
    private static final Locator A_HREF_MEMBERS_COMMON_EN_US_14 = new Locator("css", "a[href='/members/common/en-us/abtmolina/community/molinacares.aspx']");
    private static final Locator BTN = new Locator("css", ".btn");
    private static final Locator CLICKER = new Locator("css", ".clicker");
    private static final Locator ARIA_LABEL_TOGGLE_NAVIGATION = new Locator("css", "[aria-label='Toggle navigation']");
    private static final Locator SSM_SUBMIT = new Locator("css", ".ssm-submit");
    private static final Locator DD_COUNTRY_TITLETEXT = new Locator("id", "dd-country_titleText");
    private static final Locator DD_LANGUAGE_TITLETEXT = new Locator("id", "dd-language_titleText");
    private static final Locator SEARCHINPUTTEXT = new Locator("id", "searchInputText");
    private static final Locator MSDRPDD20_TITLETEXT = new Locator("id", "msdrpdd20_titleText");
    private static final Locator MSDROPDOWN21_TITLETEXT = new Locator("id", "msdropdown21_titleText");
    private static final Locator NAME_FXB_460DBA41_5AC6_465B_9913 = new Locator("name", "fxb.460dba41-5ac6-465b-9913-9094f1ae4ec6.904a58e4-9e0a-4627-9112-d008a14193e2");
    private static final Locator NAME_FXB_460DBA41_5AC6_465B_9913_2 = new Locator("css", "[name='fxb.460dba41-5ac6-465b-9913-9094f1ae4ec6.Fields[38411806-0037-4eac-8192-2e687b216dd7].Value']");
    private static final Locator NAME_FXB_460DBA41_5AC6_465B_9913_3 = new Locator("css", "[name='fxb.460dba41-5ac6-465b-9913-9094f1ae4ec6.Fields[db561f35-d0cd-4988-84c3-f62990f8f300].Value']");

    public MolinaHealthcareOfArizonaPage(WebDriver driver) {
        super(driver);
        assertVisible(IMAGE);
        assertVisible(REGISTERURL);
        assertVisible(ENROLLMENTANDRENEWAL_NAV);
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs() {
        click(A_HREF_MEMBERS_COMMON_EN_US);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMainContent() {
        click(A_HREF_MAIN_CONTENT);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickImage() {
        click(IMAGE);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs2() {
        click(A_HREF_MEMBERS_COMMON_EN_US_2);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpsMemberMolinahealthcareCom() {
        click(A_HREF_HTTPS_MEMBER_MOLINAHEALTHCARE_COM);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpsWwwAvailityCom() {
        click(A_HREF_HTTPS_WWW_AVAILITY_COM);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickRegisterurl() {
        click(REGISTERURL);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersAzEnUs() {
        click(A_HREF_MEMBERS_AZ_EN_US);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickEnrollmentandrenewalNav() {
        click(ENROLLMENTANDRENEWAL_NAV);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersAzEnUs2() {
        click(A_HREF_MEMBERS_AZ_EN_US_2);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersAzEnUs3() {
        click(A_HREF_MEMBERS_AZ_EN_US_3);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickMembersNav() {
        click(MEMBERS_NAV);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersAzEnUs4() {
        click(A_HREF_MEMBERS_AZ_EN_US_4);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersAzEnUs5() {
        click(A_HREF_MEMBERS_AZ_EN_US_5);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersAzEnUs6() {
        click(A_HREF_MEMBERS_AZ_EN_US_6);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpsMemberMolinahealthcareCom2() {
        click(A_HREF_HTTPS_MEMBER_MOLINAHEALTHCARE_COM_2);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpWwwMolinahelpfinderCom() {
        click(A_HREF_HTTP_WWW_MOLINAHELPFINDER_COM);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersAzEnUs7() {
        click(A_HREF_MEMBERS_AZ_EN_US_7);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickHealthcareprofessionalsNav() {
        click(HEALTHCAREPROFESSIONALS_NAV);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefProvidersAzMedicaidHome() {
        click(A_HREF_PROVIDERS_AZ_MEDICAID_HOME);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefProvidersCommonMedicareMedicare() {
        click(A_HREF_PROVIDERS_COMMON_MEDICARE_MEDICARE);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpsWwwAvailityCom2() {
        click(A_HREF_HTTPS_WWW_AVAILITY_COM_2);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpsMolinaSapphirethreesixtyfiveCom() {
        click(A_HREF_HTTPS_MOLINA_SAPPHIRETHREESIXTYFIVE_COM);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickBrokersNav() {
        click(BROKERS_NAV);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpsWwwMolinamarketplaceCom() {
        click(A_HREF_HTTPS_WWW_MOLINAMARKETPLACE_COM);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs3() {
        click(A_HREF_MEMBERS_COMMON_EN_US_3);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAboutmolinaNav() {
        click(ABOUTMOLINA_NAV);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs4() {
        click(A_HREF_MEMBERS_COMMON_EN_US_4);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs5() {
        click(A_HREF_MEMBERS_COMMON_EN_US_5);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefBlogPagesHomeAspx() {
        click(A_HREF_BLOG_PAGES_HOME_ASPX);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs6() {
        click(A_HREF_MEMBERS_COMMON_EN_US_6);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpsCareersMolinahealthcareCom() {
        click(A_HREF_HTTPS_CAREERS_MOLINAHEALTHCARE_COM);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs7() {
        click(A_HREF_MEMBERS_COMMON_EN_US_7);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs8() {
        click(A_HREF_MEMBERS_COMMON_EN_US_8);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs9() {
        click(A_HREF_MEMBERS_COMMON_EN_US_9);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs10() {
        click(A_HREF_MEMBERS_COMMON_EN_US_10);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs11() {
        click(A_HREF_MEMBERS_COMMON_EN_US_11);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefHttpsInvestorsMolinahealthcareCom() {
        click(A_HREF_HTTPS_INVESTORS_MOLINAHEALTHCARE_COM);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs12() {
        click(A_HREF_MEMBERS_COMMON_EN_US_12);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs13() {
        click(A_HREF_MEMBERS_COMMON_EN_US_13);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAHrefMembersCommonEnUs14() {
        click(A_HREF_MEMBERS_COMMON_EN_US_14);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickBtn() {
        click(BTN);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickClicker() {
        click(CLICKER);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickAriaLabelToggleNavigation() {
        click(ARIA_LABEL_TOGGLE_NAVIGATION);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickSsmSubmit() {
        click(SSM_SUBMIT);
        return this;
    }

    public MolinaHealthcareOfArizonaPage enterDdCountryTitletext(String value) {
        fill(DD_COUNTRY_TITLETEXT, value);
        return this;
    }

    public MolinaHealthcareOfArizonaPage enterDdLanguageTitletext(String value) {
        fill(DD_LANGUAGE_TITLETEXT, value);
        return this;
    }

    public MolinaHealthcareOfArizonaPage enterSearchinputtext(String value) {
        fill(SEARCHINPUTTEXT, value);
        return this;
    }

    public MolinaHealthcareOfArizonaPage enterMsdrpdd20Titletext(String value) {
        fill(MSDRPDD20_TITLETEXT, value);
        return this;
    }

    public MolinaHealthcareOfArizonaPage enterMsdropdown21Titletext(String value) {
        fill(MSDROPDOWN21_TITLETEXT, value);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickNameFxb460dba415ac6465b9913() {
        click(NAME_FXB_460DBA41_5AC6_465B_9913);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickNameFxb460dba415ac6465b99132() {
        click(NAME_FXB_460DBA41_5AC6_465B_9913_2);
        return this;
    }

    public MolinaHealthcareOfArizonaPage clickNameFxb460dba415ac6465b99133() {
        click(NAME_FXB_460DBA41_5AC6_465B_9913_3);
        return this;
    }
}
