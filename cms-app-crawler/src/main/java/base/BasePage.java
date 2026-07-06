package base;

import org.openqa.selenium.*;
import org.openqa.selenium.support.ui.*;
import utils.SelectorRegistry;
import java.time.Duration;
import java.util.List;
import java.util.logging.Logger;

public abstract class BasePage {

    protected WebDriver driver;
    private static final Logger log = Logger.getLogger(BasePage.class.getName());

    public BasePage(WebDriver driver) {
        this.driver = driver;
        waitForReady();
    }

    protected void waitForReady() {
        new WebDriverWait(driver, Duration.ofSeconds(30))
            .until(d -> ((JavascriptExecutor) d)
                .executeScript("return document.readyState").equals("complete"));
    }

    protected void click(Locator locator) {
        WebElement el = findElement(locator);
        ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView({block:'center'});", el);
        try {
            el.click();
        } catch (ElementClickInterceptedException e) {
            ((JavascriptExecutor) driver).executeScript("arguments[0].click();", el);
        }
    }

    protected void fill(Locator locator, String value) {
        WebElement el = findElement(locator);
        el.clear();
        el.sendKeys(value);
    }

    protected void select(Locator locator, String value) {
        new Select(findElement(locator)).selectByVisibleText(value);
    }

    protected void assertVisible(Locator locator) {
        boolean visible = false;
        try { visible = findElement(locator).isDisplayed(); }
        catch (Exception ignored) {}
        if (!visible) throw new AssertionError(
            "Expected element not visible: [" + locator + "] on: " + driver.getTitle());
    }

    public BasePage assertPageLoaded() {
        waitForReady();
        return this;
    }

    protected void assertTitle(String expected) {
        String actual = driver.getTitle();
        if (!actual.contains(expected)) throw new AssertionError(
            "Expected title: [" + expected + "] got: [" + actual + "]");
    }

    protected String getText(Locator locator) {
        return findElement(locator).getText();
    }

    protected String getCurrentUrl() { return driver.getCurrentUrl(); }

    private WebElement findElement(Locator locator) {
        String selectorKey = locator.getSelectorKey();

        // Try the primary selector first
        try {
            return driver.findElement(resolveBy(locator));
        } catch (NoSuchElementException primary) {
            // Primary failed — try fallbacks from registry in priority order
            List<String> fallbacks = SelectorRegistry.getFallbacks(selectorKey);
            for (String fallback : fallbacks) {
                try {
                    WebElement el = driver.findElement(resolveByString(fallback));
                    log.warning(String.format(
                        "Self-healing: [%s] not found, used fallback [%s] on page: %s",
                        selectorKey, fallback, driver.getTitle()));
                    return el;
                } catch (NoSuchElementException ignored) {}
            }
            // All fallbacks exhausted
            throw new AssertionError(String.format(
                "Element not found: [%s] and all %d fallback(s) failed. Page: %s",
                selectorKey, fallbacks.size(), driver.getTitle()));
        }
    }

    private By resolveBy(Locator locator) {
        return resolveByString(locator.getSelectorKey());
    }

    // Resolves the selectorKey string format used by the registry
    private By resolveByString(String sk) {
        if (sk == null || sk.isEmpty()) return By.cssSelector("*");
        if (sk.startsWith("xpath="))             return By.xpath(sk.substring(6));
        if (sk.startsWith("#"))                  return By.id(sk.substring(1));
        if (sk.startsWith("[name='"))            return By.name(sk.replaceAll("\\[name='([^']+)'\\]", "$1"));
        if (sk.startsWith("data-testid="))       return By.cssSelector("[data-testid='" + sk.substring(12) + "']");
        if (sk.startsWith("aria-label="))        return By.cssSelector("[aria-label='" + sk.substring(11) + "']");
        if (sk.startsWith("input[type='"))       return By.cssSelector(sk);
        return By.cssSelector(sk);
    }
}
