import fs from 'fs';
import path from 'path';

const TESTDATA_DIR = path.join(__dirname, '../../resources/testdata');

function getData<T = Record<string, string>>(methodName: string): T[] {
  const filePath = path.join(TESTDATA_DIR, `${methodName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No test data JSON found for: ${methodName} (expected: ${filePath})`);
  }
  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(rows)) {
    throw new Error(`Test data file must contain a JSON array: ${filePath}`);
  }
  return rows as T[];
}

export const JsonDataProvider = { getData };
