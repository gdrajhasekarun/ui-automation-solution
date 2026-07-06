package utils;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.logging.Logger;

/**
 * Loads pom_registry.json at test startup and provides fallback selector lookup
 * for self-healing in BasePage.findElement().
 *
 * Call SelectorRegistry.load(path) once in @BeforeClass, not per test.
 */
public class SelectorRegistry {

    private static final Logger log = Logger.getLogger(SelectorRegistry.class.getName());
    private static final Map<String, List<String>> fallbackMap = new HashMap<>();
    private static boolean loaded = false;

    public static void load(String registryPath) throws IOException {
        ObjectMapper mapper = new ObjectMapper();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> registry = (List<Map<String, Object>>) mapper.readValue(new File(registryPath), List.class);
        fallbackMap.clear();
        for (Map<String, Object> entry : registry) {
            String selectorKey = (String) entry.get("selectorKey");
            if (selectorKey == null) continue;
            @SuppressWarnings("unchecked")
            List<String> fallbacks = (List<String>) entry.getOrDefault("selectorFallbacks", new ArrayList<>());
            fallbackMap.put(selectorKey, fallbacks);
        }
        loaded = true;
        log.info(String.format("SelectorRegistry loaded: %d entries from %s", fallbackMap.size(), registryPath));
    }

    public static List<String> getFallbacks(String selectorKey) {
        if (!loaded) {
            log.warning("SelectorRegistry.load() was never called — no fallbacks available");
        }
        return fallbackMap.getOrDefault(selectorKey, Collections.emptyList());
    }
}
