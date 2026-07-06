package utils;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

public class JsonDataProvider {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @org.testng.annotations.DataProvider(name = "jsonData")
    public static Object[][] getData(Method m) throws Exception {
        String resource = "/testdata/" + m.getName() + ".json";
        try (InputStream is = JsonDataProvider.class.getResourceAsStream(resource)) {
            if (is == null) {
                throw new RuntimeException("No test data JSON found for: " + m.getName()
                    + " (expected classpath resource: " + resource + ")");
            }
            List<Map<String, String>> rows = MAPPER.readValue(is, new TypeReference<>() {});
            return rows.stream()
                .map(row -> row.values().toArray())
                .toArray(Object[][]::new);
        }
    }
}
