// AUTO-GENERATED — DO NOT EDIT
// Regenerate via POST /trigger

package pages;

import base.BasePage;
import base.Locator;
import org.openqa.selenium.WebDriver;

public class HealthInsurancePlansAetnaPage extends BasePage {

    private static final Locator SKIP_LINK = new Locator("css", ".skip__link");
    private static final Locator AETNA = new Locator("id", "Aetna");
    private static final Locator MEDICARE = new Locator("id", "Medicare");
    private static final Locator MEDICAID = new Locator("id", "Medicaid");
    private static final Locator ARIA_LABEL_BACK = new Locator("css", "aria-label=back");
    private static final Locator DATA_LINKLOCATION_NAVIGATION = new Locator("css", "[data-linklocation='Navigation']");
    private static final Locator DATA_ANALYTICS_NAME_MEMBER_LOG_IN = new Locator("css", "[data-analytics-name='Member log-in']");
    private static final Locator DATA_ANALYTICS_NAME_CREATE_MY_ACCOUNT = new Locator("css", "[data-analytics-name='Create my account']");
    private static final Locator ARIA_LABEL_MEDICARE_MEMBER_LOG_IN = new Locator("css", "aria-label=Medicare member log-in");
    private static final Locator ARIA_LABEL_INDIVIDUAL_FAMILY_ACA_MEMBER = new Locator("css", "aria-label=Individual & family ACA member log-in");
    private static final Locator ARIA_LABEL_MEDICAID_MEMBER_LOG_IN = new Locator("css", "aria-label=Medicaid member log-in");
    private static final Locator ARIA_LABEL_MEDICAL_PROVIDERS_LOG_IN = new Locator("css", "aria-label=Medical providers log-in");
    private static final Locator ARIA_LABEL_AGENTS_AND_BROKERS_LOG = new Locator("css", "aria-label=Agents and brokers log-in");
    private static final Locator ARIA_LABEL_EMPLOYERS_LOG_IN = new Locator("css", "aria-label=Employers log-in");
    private static final Locator ARIA_LABEL_DENTAL_PROVIDERS_LOG_IN = new Locator("css", "aria-label=Dental providers log-in");
    private static final Locator DATA_MODAL_PLEASE_SELECT = new Locator("css", "[data-modal='Please Select']");
    private static final Locator ARIA_LABEL_LOG_IN_TO_MY = new Locator("css", "aria-label=Log in to my member account");
    private static final Locator DATA_ANALYTICS_NAME_MEMBER_WELCOME_GUIDE = new Locator("css", "[data-analytics-name='Member welcome guide']");
    private static final Locator LOGO_LINK = new Locator("css", ".logo__link");
    private static final Locator ARIA_LABEL_FOLLOW_US_ON_FACEBOOK = new Locator("css", "aria-label=Follow us on facebook");
    private static final Locator ARIA_LABEL_FOLLOW_US_ON_INSTAGRAM = new Locator("css", "aria-label=Follow us on instagram");
    private static final Locator ARIA_LABEL_FOLLOW_US_ON_LINKEDIN = new Locator("css", "aria-label=Follow us on linkedin");
    private static final Locator ARIA_LABEL_FOLLOW_US_ON_YOUTUBE = new Locator("css", "aria-label=Follow us on youtube");
    private static final Locator ARIA_LABEL_AETNA_CONTACT_US = new Locator("css", "aria-label=Aetna: Contact us");
    private static final Locator ARIA_LABEL_AETNA_BETTER_HEALTH_CONTACT = new Locator("css", "aria-label=Aetna Better Health: Contact us");
    private static final Locator ARIA_LABEL_AETNA_INTERNATIONAL_CONTACT_US = new Locator("css", "aria-label=Aetna International: Contact us");
    private static final Locator ARIA_LABEL_AETNA_MEDICARE_CONTACT_US = new Locator("css", "aria-label=Aetna Medicare: Contact us");
    private static final Locator ARIA_LABEL_AETNA_STUDENT_HEALTH_CONTACT = new Locator("css", "aria-label=Aetna Student Health: Contact us");
    private static final Locator DATA_ANALYTICS_NAME_ABOUT_AETNA = new Locator("css", "[data-analytics-name='About Aetna']");
    private static final Locator DATA_ANALYTICS_NAME_CAREERS = new Locator("css", "[data-analytics-name='Careers']");
    private static final Locator DATA_ANALYTICS_NAME_INVESTOR_INFO = new Locator("css", "[data-analytics-name='Investor info']");
    private static final Locator DATA_ANALYTICS_NAME_NEWS_AND_INSIGHTS = new Locator("css", "[data-analytics-name='News and insights']");
    private static final Locator DATA_ANALYTICS_NAME_LEGAL_NOTICES = new Locator("css", "[data-analytics-name='Legal notices']");
    private static final Locator DATA_ANALYTICS_NAME_PLAN_DISCLOSURES = new Locator("css", "[data-analytics-name='Plan disclosures']");
    private static final Locator DATA_ANALYTICS_NAME_PROGRAM_PROVISIONS = new Locator("css", "[data-analytics-name='Program provisions']");
    private static final Locator DATA_ANALYTICS_NAME_TERMS_OF_USE = new Locator("css", "[data-analytics-name='Terms of use']");
    private static final Locator DATA_ANALYTICS_NAME_FILE_A_GRIEVANCE = new Locator("css", "[data-analytics-name='File a grievance or appeal']");
    private static final Locator DATA_ANALYTICS_NAME_FIND_A_DOCTOR = new Locator("css", "[data-analytics-name='Find a doctor']");
    private static final Locator DATA_ANALYTICS_NAME_FIND_A_DRUG = new Locator("css", "[data-analytics-name='Find a drug']");
    private static final Locator DATA_ANALYTICS_NAME_FIND_INSURANCE_FAQS = new Locator("css", "[data-analytics-name='Find insurance FAQs']");
    private static final Locator DATA_ANALYTICS_NAME_GET_THE_AETNA = new Locator("css", "[data-analytics-name='Get the Aetna Health app']");
    private static final Locator DATA_ANALYTICS_NAME_SEARCH_HEALTH_CARE = new Locator("css", "[data-analytics-name='Search health care terms']");
    private static final Locator DATA_ANALYTICS_NAME_SITE_MAP = new Locator("css", "[data-analytics-name='Site map']");
    private static final Locator DATA_ANALYTICS_NAME_ACCESSIBILITY_SERVICES = new Locator("css", "[data-analytics-name='Accessibility services']");
    private static final Locator DATA_ANALYTICS_NAME_FRAUD_WASTE_AND = new Locator("css", "[data-analytics-name='Fraud, waste and abuse']");
    private static final Locator DATA_ANALYTICS_NAME_HEALTH_CARE_REFORM = new Locator("css", "[data-analytics-name='Health care reform']");
    private static final Locator DATA_ANALYTICS_NAME_NON_DISCRIMINATION_NOTICE = new Locator("css", "[data-analytics-name='Non-discrimination notice']");
    private static final Locator DATA_ANALYTICS_NAME_PRIVACY_CENTER = new Locator("css", "[data-analytics-name='Privacy center']");
    private static final Locator DATA_ANALYTICS_NAME_WEBSITE_SECURITY_PROGRAM = new Locator("css", "[data-analytics-name='Website security program']");
    private static final Locator ARIA_LABEL_ESPA_OL_SPANISH = new Locator("css", "aria-label=Español-Spanish");
    private static final Locator ARIA_LABEL = new Locator("css", "aria-label=中文");
    private static final Locator ARIA_LABEL_TI_NG_VI_T = new Locator("css", "aria-label=Tiếng Việt");
    private static final Locator ARIA_LABEL_ARIALABEL = new Locator("css", "aria-label=한국어");
    private static final Locator ARIA_LABEL_TAGALOG = new Locator("css", "aria-label=Tagalog");
    private static final Locator ARIA_LABEL_P = new Locator("css", "aria-label=Pусский");
    private static final Locator ARIA_LABEL_ARIALABEL = new Locator("css", "aria-label=العربية");
    private static final Locator ARIA_LABEL_KREY_L = new Locator("css", "aria-label=Kreyòl");
    private static final Locator ARIA_LABEL_FRAN_AIS = new Locator("css", "aria-label=Français");
    private static final Locator ARIA_LABEL_POLSKI = new Locator("css", "aria-label=Polski");
    private static final Locator ARIA_LABEL_PORTUGU_S = new Locator("css", "aria-label=Português");
    private static final Locator ARIA_LABEL_ITALIANO = new Locator("css", "aria-label=Italiano");
    private static final Locator ARIA_LABEL_DEUTSCH = new Locator("css", "aria-label=Deutsch");
    private static final Locator ARIA_LABEL_ARIALABEL = new Locator("css", "aria-label=日本語");
    private static final Locator ARIA_LABEL_ARIALABEL = new Locator("css", "aria-label=فارسی");
    private static final Locator ARIA_LABEL_OTHER_LANGUAGES = new Locator("css", "aria-label=Other languages ...");
    private static final Locator DATA_ANALYTICS_NAME_BACK = new Locator("css", "[data-analytics-name='back']");
    private static final Locator DATA_ANALYTICS_NAME_SEE_CMS_S = new Locator("css", "[data-analytics-name='See CMS's Medicare Coverage Center']");
    private static final Locator DATA_ANALYTICS_NAME_SEE_AETNA_S = new Locator("css", "[data-analytics-name='See Aetna's External Review Program']");
    private static final Locator DATA_ANALYTICS_NAME_GO_TO_THE = new Locator("css", "[data-analytics-name='Go to the American Medical Association Web site']");
    private static final Locator DATA_ANALYTICS_NAME_HEALTHCARE_GOV_SITE = new Locator("css", "[data-analytics-name='Healthcare.gov site']");
    private static final Locator ARIA_LABEL_POWERED_BY_ONETRUST_OPENS = new Locator("css", "aria-label=Powered by OneTrust Opens in a new Tab");
    private static final Locator ARIA_LABEL_MORE_AETNA = new Locator("css", "aria-label=More Aetna");
    private static final Locator ARIA_LABEL_CLOSE = new Locator("css", "aria-label=Close");
    private static final Locator ARIA_LABEL_EXPLORE_SITE = new Locator("css", "aria-label=Explore site");
    private static final Locator ARIA_LABEL_CLOSE_ARIALABELCLOSE = new Locator("css", "aria-label=close");
    private static final Locator ARIA_LABEL_LOG_IN = new Locator("css", "aria-label=Log in");
    private static final Locator ARIA_LABEL_CLEAR_SEARCH = new Locator("css", "aria-label=clear search");
    private static final Locator ARIA_LABEL_SEARCH = new Locator("css", "aria-label=search");
    private static final Locator ARIA_LABEL_OPEN_MENU = new Locator("css", "aria-label=Open Menu");
    private static final Locator DATA_ANALYTICS_NAME_FIND_PLANS = new Locator("css", "[data-analytics-name='Find plans']");
    private static final Locator DATA_ANALYTICS_NAME_MEMBER_RESOURCES = new Locator("css", "[data-analytics-name='Member resources']");
    private static final Locator ARIA_LABEL_BACK_ARIALABELBACK = new Locator("css", "aria-label=Back");
    private static final Locator ARIA_LABEL_FILTER = new Locator("css", "aria-label=Filter");
    private static final Locator NEBULA_DIV_BTN = new Locator("id", "nebula_div_btn");
    private static final Locator NAME_QUERY = new Locator("name", "query");
    private static final Locator MOBILENUMBERS = new Locator("id", "mobileNumbers");
    private static final Locator INPUT_TYPE_SUBMIT = new Locator("css", "input[type='submit']");
    private static final Locator NAME_OT_GROUP_ID_C0011 = new Locator("name", "ot-group-id-C0011");
    private static final Locator NAME_OT_GROUP_ID_C0012 = new Locator("name", "ot-group-id-C0012");
    private static final Locator NAME_OT_GROUP_ID_C0013 = new Locator("name", "ot-group-id-C0013");
    private static final Locator ARIA_LABEL_COOKIE_LIST_SEARCH = new Locator("css", "aria-label=Cookie list search");
    private static final Locator CHKBOX_ID = new Locator("id", "chkbox-id");
    private static final Locator INPUT_TYPE_CHECKBOX = new Locator("css", "input[type='checkbox']");

    public HealthInsurancePlansAetnaPage(WebDriver driver) {
        super(driver);

    }

    public HealthInsurancePlansAetnaPage clickSkipLink() {
        click(SKIP_LINK);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAetna() {
        click(AETNA);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickMedicare() {
        click(MEDICARE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickMedicaid() {
        click(MEDICAID);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelBack() {
        click(ARIA_LABEL_BACK);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataLinklocationNavigation() {
        click(DATA_LINKLOCATION_NAVIGATION);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameMemberLogIn() {
        click(DATA_ANALYTICS_NAME_MEMBER_LOG_IN);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameCreateMyAccount() {
        click(DATA_ANALYTICS_NAME_CREATE_MY_ACCOUNT);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelMedicareMemberLogIn() {
        click(ARIA_LABEL_MEDICARE_MEMBER_LOG_IN);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelIndividualFamilyAcaMember() {
        click(ARIA_LABEL_INDIVIDUAL_FAMILY_ACA_MEMBER);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelMedicaidMemberLogIn() {
        click(ARIA_LABEL_MEDICAID_MEMBER_LOG_IN);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelMedicalProvidersLogIn() {
        click(ARIA_LABEL_MEDICAL_PROVIDERS_LOG_IN);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelAgentsAndBrokersLog() {
        click(ARIA_LABEL_AGENTS_AND_BROKERS_LOG);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelEmployersLogIn() {
        click(ARIA_LABEL_EMPLOYERS_LOG_IN);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelDentalProvidersLogIn() {
        click(ARIA_LABEL_DENTAL_PROVIDERS_LOG_IN);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataModalPleaseSelect() {
        click(DATA_MODAL_PLEASE_SELECT);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelLogInToMy() {
        click(ARIA_LABEL_LOG_IN_TO_MY);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameMemberWelcomeGuide() {
        click(DATA_ANALYTICS_NAME_MEMBER_WELCOME_GUIDE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickLogoLink() {
        click(LOGO_LINK);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelFollowUsOnFacebook() {
        click(ARIA_LABEL_FOLLOW_US_ON_FACEBOOK);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelFollowUsOnInstagram() {
        click(ARIA_LABEL_FOLLOW_US_ON_INSTAGRAM);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelFollowUsOnLinkedin() {
        click(ARIA_LABEL_FOLLOW_US_ON_LINKEDIN);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelFollowUsOnYoutube() {
        click(ARIA_LABEL_FOLLOW_US_ON_YOUTUBE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelAetnaContactUs() {
        click(ARIA_LABEL_AETNA_CONTACT_US);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelAetnaBetterHealthContact() {
        click(ARIA_LABEL_AETNA_BETTER_HEALTH_CONTACT);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelAetnaInternationalContactUs() {
        click(ARIA_LABEL_AETNA_INTERNATIONAL_CONTACT_US);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelAetnaMedicareContactUs() {
        click(ARIA_LABEL_AETNA_MEDICARE_CONTACT_US);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelAetnaStudentHealthContact() {
        click(ARIA_LABEL_AETNA_STUDENT_HEALTH_CONTACT);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameAboutAetna() {
        click(DATA_ANALYTICS_NAME_ABOUT_AETNA);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameCareers() {
        click(DATA_ANALYTICS_NAME_CAREERS);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameInvestorInfo() {
        click(DATA_ANALYTICS_NAME_INVESTOR_INFO);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameNewsAndInsights() {
        click(DATA_ANALYTICS_NAME_NEWS_AND_INSIGHTS);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameLegalNotices() {
        click(DATA_ANALYTICS_NAME_LEGAL_NOTICES);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNamePlanDisclosures() {
        click(DATA_ANALYTICS_NAME_PLAN_DISCLOSURES);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameProgramProvisions() {
        click(DATA_ANALYTICS_NAME_PROGRAM_PROVISIONS);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameTermsOfUse() {
        click(DATA_ANALYTICS_NAME_TERMS_OF_USE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameFileAGrievance() {
        click(DATA_ANALYTICS_NAME_FILE_A_GRIEVANCE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameFindADoctor() {
        click(DATA_ANALYTICS_NAME_FIND_A_DOCTOR);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameFindADrug() {
        click(DATA_ANALYTICS_NAME_FIND_A_DRUG);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameFindInsuranceFaqs() {
        click(DATA_ANALYTICS_NAME_FIND_INSURANCE_FAQS);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameGetTheAetna() {
        click(DATA_ANALYTICS_NAME_GET_THE_AETNA);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameSearchHealthCare() {
        click(DATA_ANALYTICS_NAME_SEARCH_HEALTH_CARE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameSiteMap() {
        click(DATA_ANALYTICS_NAME_SITE_MAP);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameAccessibilityServices() {
        click(DATA_ANALYTICS_NAME_ACCESSIBILITY_SERVICES);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameFraudWasteAnd() {
        click(DATA_ANALYTICS_NAME_FRAUD_WASTE_AND);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameHealthCareReform() {
        click(DATA_ANALYTICS_NAME_HEALTH_CARE_REFORM);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameNonDiscriminationNotice() {
        click(DATA_ANALYTICS_NAME_NON_DISCRIMINATION_NOTICE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNamePrivacyCenter() {
        click(DATA_ANALYTICS_NAME_PRIVACY_CENTER);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameWebsiteSecurityProgram() {
        click(DATA_ANALYTICS_NAME_WEBSITE_SECURITY_PROGRAM);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelEspaOlSpanish() {
        click(ARIA_LABEL_ESPA_OL_SPANISH);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabel() {
        click(ARIA_LABEL);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelTiNgViT() {
        click(ARIA_LABEL_TI_NG_VI_T);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabel2() {
        click(ARIA_LABEL_ARIALABEL);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelTagalog() {
        click(ARIA_LABEL_TAGALOG);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelP() {
        click(ARIA_LABEL_P);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabel3() {
        click(ARIA_LABEL_ARIALABEL);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelKreyL() {
        click(ARIA_LABEL_KREY_L);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelFranAis() {
        click(ARIA_LABEL_FRAN_AIS);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelPolski() {
        click(ARIA_LABEL_POLSKI);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelPortuguS() {
        click(ARIA_LABEL_PORTUGU_S);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelItaliano() {
        click(ARIA_LABEL_ITALIANO);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelDeutsch() {
        click(ARIA_LABEL_DEUTSCH);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabel4() {
        click(ARIA_LABEL_ARIALABEL);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabel5() {
        click(ARIA_LABEL_ARIALABEL);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelOtherLanguages() {
        click(ARIA_LABEL_OTHER_LANGUAGES);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameBack() {
        click(DATA_ANALYTICS_NAME_BACK);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameSeeCmsS() {
        click(DATA_ANALYTICS_NAME_SEE_CMS_S);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameSeeAetnaS() {
        click(DATA_ANALYTICS_NAME_SEE_AETNA_S);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameGoToThe() {
        click(DATA_ANALYTICS_NAME_GO_TO_THE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameHealthcareGovSite() {
        click(DATA_ANALYTICS_NAME_HEALTHCARE_GOV_SITE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelPoweredByOnetrustOpens() {
        click(ARIA_LABEL_POWERED_BY_ONETRUST_OPENS);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelMoreAetna() {
        click(ARIA_LABEL_MORE_AETNA);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelClose() {
        click(ARIA_LABEL_CLOSE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelExploreSite() {
        click(ARIA_LABEL_EXPLORE_SITE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelClose2() {
        click(ARIA_LABEL_CLOSE_ARIALABELCLOSE);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelLogIn() {
        click(ARIA_LABEL_LOG_IN);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelClearSearch() {
        click(ARIA_LABEL_CLEAR_SEARCH);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelSearch() {
        click(ARIA_LABEL_SEARCH);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelOpenMenu() {
        click(ARIA_LABEL_OPEN_MENU);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameFindPlans() {
        click(DATA_ANALYTICS_NAME_FIND_PLANS);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickDataAnalyticsNameMemberResources() {
        click(DATA_ANALYTICS_NAME_MEMBER_RESOURCES);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelBack2() {
        click(ARIA_LABEL_BACK_ARIALABELBACK);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickAriaLabelFilter() {
        click(ARIA_LABEL_FILTER);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickNebulaDivBtn() {
        click(NEBULA_DIV_BTN);
        return this;
    }

    public HealthInsurancePlansAetnaPage enterNameQuery(String value) {
        fill(NAME_QUERY, value);
        return this;
    }

    public HealthInsurancePlansAetnaPage enterMobilenumbers(String value) {
        fill(MOBILENUMBERS, value);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickInputTypeSubmit() {
        click(INPUT_TYPE_SUBMIT);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickNameOtGroupIdC0011() {
        click(NAME_OT_GROUP_ID_C0011);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickNameOtGroupIdC0012() {
        click(NAME_OT_GROUP_ID_C0012);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickNameOtGroupIdC0013() {
        click(NAME_OT_GROUP_ID_C0013);
        return this;
    }

    public HealthInsurancePlansAetnaPage enterAriaLabelCookieListSearch(String value) {
        fill(ARIA_LABEL_COOKIE_LIST_SEARCH, value);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickChkboxId() {
        click(CHKBOX_ID);
        return this;
    }

    public HealthInsurancePlansAetnaPage clickInputTypeCheckbox() {
        click(INPUT_TYPE_CHECKBOX);
        return this;
    }
}
