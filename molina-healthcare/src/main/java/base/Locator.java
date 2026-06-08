package base;

import lombok.Value;

@Value
public class Locator {
    String type;   // "css" | "xpath" | "id" | "name" | "data-testid" | "aria-label"
    String value;

    /** Reconstructs the selectorKey string used in pom_registry.json for fallback lookup. */
    public String getSelectorKey() {
        switch (type) {
            case "id":          return "#" + value;
            case "name":        return "[name='" + value + "']";
            case "xpath":       return "xpath=" + value;
            case "data-testid": return "data-testid=" + value;
            case "aria-label":  return "aria-label=" + value;
            default:            return value;  // css selector stored as-is
        }
    }
}
