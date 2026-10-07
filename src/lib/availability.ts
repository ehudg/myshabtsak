import { readSheet } from 'read-excel-file/browser';
import { addDaysKey, todayKey, type DateKey } from './time';

export type AvailabilityStatus = 'home' | 'active' | 'leaving' | 'returning' | 'unknown';

export interface DayAvailability {
  date: DateKey;
  value: number | null;
  status: AvailabilityStatus;
}

export interface SoldierAvailability {
  uid: string;
  name: string;
  days: DayAvailability[];
}

const SHEET_NAME = 'availability matrix';
const FIRST_DATE_COLUMN = 5;

function excelDateKey(value: unknown): DateKey | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function statusOf(value: number | null, previousValue: number | null): AvailabilityStatus {
  if (value === 0) return 'home';
  if (value === 1) return 'active';
  if (value === 0.5) {
    if (previousValue === 0) return 'returning';
    if (previousValue === 1) return 'leaving';
  }
  return 'unknown';
}

/** Read each soldier's availability for the selected date and the following two days from the workbook. */
export async function readThreeDayAvailability(
  file: File | ArrayBuffer,
  startDate: DateKey = todayKey(),
): Promise<SoldierAvailability[]> {
  const rows = await readSheet(file, SHEET_NAME);
  if (!rows.length) throw new Error(`Workbook is missing the "${SHEET_NAME}" sheet`);
  const cellValue = (row: number, column: number): unknown => rows[row]?.[column];

  const columnsByDate = new Map<DateKey, number>();
  for (let column = FIRST_DATE_COLUMN; column < (rows[0]?.length ?? 0); column++) {
    const date = excelDateKey(cellValue(0, column));
    if (date && !columnsByDate.has(date)) columnsByDate.set(date, column);
  }

  const dates = [startDate, addDaysKey(startDate, 1), addDaysKey(startDate, 2)];
  const missingDates = dates.filter(date => !columnsByDate.has(date));
  if (missingDates.length) throw new Error(`Workbook is missing date columns: ${missingDates.join(', ')}`);

  const soldiers: SoldierAvailability[] = [];
  for (let row = 2; row < rows.length; row++) {
    const uidValue = cellValue(row, 0);
    const nameValue = cellValue(row, 1);
    const uid = uidValue == null ? '' : String(uidValue).trim();
    const name = nameValue == null ? '' : String(nameValue).trim();
    if (!uid || !name) continue;

    const days = dates.map(date => {
      const column = columnsByDate.get(date)!;
      const previousColumn = columnsByDate.get(addDaysKey(date, -1));
      const value = numericValue(cellValue(row, column));
      const previousValue = previousColumn === undefined ? null : numericValue(cellValue(row, previousColumn));
      return { date, value, status: statusOf(value, previousValue) };
    });
    soldiers.push({ uid, name, days });
  }
  return soldiers;
}