package utils;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import java.io.*;
import java.util.*;

public class ExcelReader {

    private static final String EXCEL_PATH = System.getProperty(
        "testdata.path", "src/test/resources/testdata.xlsx");

    public static Object[][] getRowsByHeader(String testCaseName) {
        List<Object[]> results = new ArrayList<>();
        try (FileInputStream fis = new FileInputStream(EXCEL_PATH);
             Workbook wb = new XSSFWorkbook(fis)) {
            Sheet sheet = wb.getSheetAt(0);
            Row header = sheet.getRow(0);
            Map<String, Integer> colMap = new LinkedHashMap<>();
            for (Cell c : header) colMap.put(c.getStringCellValue().trim(), c.getColumnIndex());
            if (!colMap.containsKey("TestCaseName"))
                throw new RuntimeException("Missing 'TestCaseName' column in: " + EXCEL_PATH);
            int tcCol = colMap.get("TestCaseName");
            List<String> dataCols = new ArrayList<>(colMap.keySet());
            dataCols.remove("TestCaseName");
            for (int i = 1; i <= sheet.getLastRowNum(); i++) {
                Row row = sheet.getRow(i);
                if (row == null) continue;
                Cell tc = row.getCell(tcCol);
                if (tc == null || !tc.getStringCellValue().trim().equals(testCaseName)) continue;
                Object[] rd = new Object[dataCols.size()];
                for (int j = 0; j < dataCols.size(); j++) {
                    Cell cell = row.getCell(colMap.get(dataCols.get(j)));
                    rd[j] = cell != null ? getCellValue(cell) : "";
                }
                results.add(rd);
            }
        } catch (IOException e) {
            throw new RuntimeException("Cannot read: " + EXCEL_PATH, e);
        }
        if (results.isEmpty())
            throw new RuntimeException("No rows for: " + testCaseName + " in " + EXCEL_PATH);
        return results.toArray(new Object[0][]);
    }

    private static String getCellValue(Cell c) {
        return switch (c.getCellType()) {
            case STRING  -> c.getStringCellValue().trim();
            case NUMERIC -> String.valueOf((long) c.getNumericCellValue());
            case BOOLEAN -> String.valueOf(c.getBooleanCellValue());
            default -> "";
        };
    }
}
