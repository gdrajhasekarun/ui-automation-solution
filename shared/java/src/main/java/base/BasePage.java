package base;

import org.openqa.selenium.*;
import org.openqa.selenium.support.ui.*;
import java.time.Duration;

public abstract class BasePage {

    protected WebDriver driver;

    public BasePage(WebDriver driver) {
        this.driver = driver;
        waitForReady();
    }

    protected void waitForReady() {
        new WebDriverWait(driver, Duration.ofSeconds(30))
            .until(d -> ((JavascriptExecutor) d)
                .executeScript("return document.readyState").equals("complete"));
    }

    protected void click(String selectorKey) { findElement(selectorKey).click(); }

    protected void fill(String selectorKey, String value) {
        WebElement el = findElement(selectorKey);
        el.clear(); el.sendKeys(value);
    }

    protected void select(String selectorKey, String value) {
        new Select(findElement(selectorKey)).selectByVisibleText(value);
    }

    protected void assertVisible(String selectorKey) {
        boolean visible = false;
        try { visible = findElement(selectorKey).isDisplayed(); }
        catch (Exception ignored) {}
        if (!visible) throw new AssertionError(
            "Expected element not visible: [" + selectorKey + "] on: " + driver.getTitle());
    }

    protected void assertTitle(String expected) {
        String actual = driver.getTitle();
        if (!actual.contains(expected)) throw new AssertionError(
            "Expected title: [" + expected + "] got: [" + actual + "]");
    }

    protected String getText(String selectorKey) {
        return findElement(selectorKey).getText();
    }

    protected String getCurrentUrl() { return driver.getCurrentUrl(); }

    private WebElement findElement(String selectorKey) {
        if (selectorKey.contains("::")) {
            String[] p = selectorKey.split("::", 2);
            driver.switchTo().frame(driver.findElement(By.cssSelector(
                "#" + p[0].replace("iframe#",""))));
            WebElement el = driver.findElement(resolveBy(p[1]));
            driver.switchTo().defaultContent();
            return el;
        }
        return driver.findElement(resolveBy(selectorKey));
    }

    private By resolveBy(String sk) {
        if (sk.startsWith("data-testid="))
            return By.cssSelector("[data-testid='" + sk.split("=",2)[1] + "']");
        if (sk.startsWith("aria-label="))
            return By.cssSelector("[aria-label='" + sk.split("=",2)[1] + "']");
        if (sk.startsWith("xpath=")) return By.xpath(sk.substring(6));
        return By.cssSelector(sk);
    }
}
