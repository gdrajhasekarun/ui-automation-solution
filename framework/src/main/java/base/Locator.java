package base;

import lombok.Value;

@Value
public class Locator {
    String type;   // "css" | "xpath" | "id" | "name"
    String value;
}
