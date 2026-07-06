from dataclasses import dataclass


@dataclass(frozen=True)
class Locator:
    type: str  # "css" | "xpath" | "id" | "name" | "data-testid" | "aria-label"
    value: str

    @property
    def selector_key(self) -> str:
        match self.type:
            case "id":          return f"#{self.value}"
            case "name":        return f"[name='{self.value}']"
            case "xpath":       return f"xpath={self.value}"
            case "data-testid": return f"data-testid={self.value}"
            case "aria-label":  return f"aria-label={self.value}"
            case _:             return self.value

    @property
    def playwright_selector(self) -> str:
        match self.type:
            case "id":          return f"#{self.value}"
            case "name":        return f"[name='{self.value}']"
            case "xpath":       return f"xpath={self.value}"
            case "data-testid": return f"[data-testid='{self.value}']"
            case "aria-label":  return f"[aria-label='{self.value}']"
            case _:             return self.value
