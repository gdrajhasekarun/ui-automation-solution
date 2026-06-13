import * as fs from 'fs'
import * as XLSXModule from 'xlsx'
// xlsx is CommonJS; when bundled as ESM the real API is on .default
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: typeof XLSXModule = ((XLSXModule as any).default ?? XLSXModule) as typeof XLSXModule

export interface CredentialRow {
  account_id: string
  username:   string
  password:   string
  role?:      string
  [key: string]: string | undefined
}

export interface FormFillRow {
  field_match: string   // normalised key e.g. "postcode", "card_number"
  value:       string
  account_id?: string   // optional — if set, only used for that account
  notes?:      string
}

export interface ExcelData {
  credentials: CredentialRow[]
  formFills:   FormFillRow[]
}

export function readExcel(filePath: string): ExcelData {
  if (!fs.existsSync(filePath)) {
    return { credentials: [], formFills: [] }
  }

  const workbook = XLSX.readFile(filePath)

  const credentials: CredentialRow[] = []
  const formFills:   FormFillRow[]   = []

  // Credentials sheet
  const credSheet = workbook.Sheets['Credentials'] ?? workbook.Sheets['credentials']
  if (credSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(credSheet, { defval: '' })
    for (const row of rows) {
      const account_id = (row['account_id'] || row['Account ID'] || '').trim()
      const username   = (row['username']   || row['Username']   || row['email'] || '').trim()
      const password   = (row['password']   || row['Password']   || '').trim()
      if (username || password) {
        credentials.push({ account_id, username, password, role: row['role'] || undefined })
      }
    }
  }

  // FormFills sheet
  const fillSheet = workbook.Sheets['FormFills'] ?? workbook.Sheets['formfills'] ?? workbook.Sheets['Form Fills']
  if (fillSheet) {
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(fillSheet, { defval: '' })
    for (const row of rows) {
      const field_match = (row['field_match'] || row['Field Match'] || row['field'] || '').trim().toLowerCase()
      const value       = (row['value']       || row['Value']       || '').trim()
      if (field_match && value) {
        formFills.push({
          field_match,
          value,
          account_id: row['account_id'] || undefined,
          notes:      row['notes']      || undefined,
        })
      }
    }
  }

  console.log(`[EXCEL] Loaded from: ${filePath}`)
  console.log(`[EXCEL] Credentials (${credentials.length}):`)
  credentials.forEach((r, i) => console.log(`  [${i + 1}] account_id="${r.account_id}"  username="${r.username}"  role="${r.role ?? ''}"`))
  console.log(`[EXCEL] FormFills (${formFills.length}):`)
  formFills.forEach((r, i) => console.log(`  [${i + 1}] field="${r.field_match}"  value="${r.value}"  account_id="${r.account_id ?? ''}"`))

  return { credentials, formFills }
}
