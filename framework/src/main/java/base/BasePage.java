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

    protected void click(Locator locator) { findElement(locator).click(); }

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
        return driver.findElement(resolveBy(locator));
    }

    private By resolveBy(Locator locator) {
        switch (locator.getType()) {
            case "id":    return By.id(locator.getValue());
            case "name":  return By.name(locator.getValue());
            case "xpath": return By.xpath(locator.getValue());
            default:      return By.cssSelector(locator.getValue());
        }
    }
}
