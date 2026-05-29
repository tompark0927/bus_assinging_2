import ExcelJS from 'exceljs';
import { prisma } from '../utils/prisma';

const SHIFT_LABELS: Record<string, string> = {
  MORNING: '오전',
  AFTERNOON: '오후',
  FULL_DAY: '종일',
};

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];

export async function generateScheduleExcel(companyId: number, year: number, month: number): Promise<Buffer> {
  const schedule = await prisma.schedule.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
    include: {
      slots: {
        include: {
          driver: { select: { id: true, name: true, employeeId: true, driverType: true } },
          route: true,
          bus: true,
        },
        orderBy: { date: 'asc' },
      },
    },
  });

  if (!schedule) throw new Error('배차표를 찾을 수 없습니다.');

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  const companyName = company?.name || '배차관리';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${companyName} 배차 시스템`;
  workbook.created = new Date();

  // ─── Sheet 1: Monthly Overview ───
  const overviewSheet = workbook.addWorksheet(`${year}년 ${month}월 배차표`, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  const daysInMonth = new Date(year, month, 0).getDate();

  // Get unique drivers from slots
  const driverMap = new Map<number, { name: string; employeeId: string; driverType: string | null }>();
  for (const slot of schedule.slots) {
    if (!driverMap.has(slot.driverId)) {
      driverMap.set(slot.driverId, {
        name: slot.driver.name,
        employeeId: slot.driver.employeeId,
        driverType: slot.driver.driverType,
      });
    }
  }

  const drivers = Array.from(driverMap.entries()).sort((a, b) =>
    a[1].name.localeCompare(b[1].name, 'ko')
  );

  // Title
  overviewSheet.mergeCells(1, 1, 1, daysInMonth + 3);
  const titleCell = overviewSheet.getCell(1, 1);
  titleCell.value = `${companyName} ${year}년 ${month}월 배차표`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  overviewSheet.getRow(1).height = 30;

  // Header row: driver info + dates
  const headerRow = overviewSheet.getRow(2);
  headerRow.getCell(1).value = '사원번호';
  headerRow.getCell(2).value = '이름';
  headerRow.getCell(3).value = '구분';

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dayOfWeek = DAYS_KR[date.getDay()];
    const cell = headerRow.getCell(d + 3);
    cell.value = `${d}\n(${dayOfWeek})`;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    // Color weekends
    if (date.getDay() === 0) {
      cell.font = { bold: true, color: { argb: 'FFCC0000' } };
    } else if (date.getDay() === 6) {
      cell.font = { bold: true, color: { argb: 'FF0000CC' } };
    }
  }

  // Style header row
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  });
  headerRow.height = 36;

  // Build slot lookup: driverId -> date -> slot
  const slotLookup = new Map<string, typeof schedule.slots[0]>();
  for (const slot of schedule.slots) {
    const key = `${slot.driverId}_${slot.date.toISOString().split('T')[0]}`;
    slotLookup.set(key, slot);
  }

  // Data rows
  let rowIndex = 3;
  for (const [driverId, driverInfo] of drivers) {
    const row = overviewSheet.getRow(rowIndex);
    row.getCell(1).value = driverInfo.employeeId;
    row.getCell(2).value = driverInfo.name;
    row.getCell(3).value = driverInfo.driverType === 'MAIN' ? '메인' : driverInfo.driverType === 'SPARE' ? '스페어' : '-';

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dateStr = date.toISOString().split('T')[0];
      const key = `${driverId}_${dateStr}`;
      const slot = slotLookup.get(key);
      const cell = row.getCell(d + 3);

      if (!slot) {
        cell.value = '-';
      } else if (slot.isRestDay) {
        cell.value = '휴';
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        cell.font = { color: { argb: 'FF9E9E9E' } };
      } else if (slot.status === 'DROPPED') {
        cell.value = '드랍';
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
        cell.font = { color: { argb: 'FFB71C1C' } };
      } else if (slot.status === 'ABSENT') {
        cell.value = '결근';
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8A65' } };
      } else {
        // Active work day: show route number
        cell.value = slot.route?.routeNumber || '○';
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
        cell.font = { color: { argb: 'FF1B5E20' } };
      }

      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };

      // Shade weekend columns
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        if (!slot || (!slot.isRestDay && slot.status !== 'DROPPED')) {
          cell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: dayOfWeek === 0 ? 'FFFFF3E0' : 'FFF3E5F5' },
          };
        }
      }
    }

    // Style row
    for (let c = 1; c <= 3; c++) {
      const cell = row.getCell(c);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    }

    row.height = 20;
    rowIndex++;
  }

  // Set column widths
  overviewSheet.getColumn(1).width = 10;
  overviewSheet.getColumn(2).width = 10;
  overviewSheet.getColumn(3).width = 8;
  for (let d = 1; d <= daysInMonth; d++) {
    overviewSheet.getColumn(d + 3).width = 5;
  }

  // ─── Sheet 2: Daily Schedule ───
  const dailySheet = workbook.addWorksheet('일별 상세');

  dailySheet.columns = [
    { header: '날짜', key: 'date', width: 12 },
    { header: '요일', key: 'day', width: 6 },
    { header: '노선', key: 'route', width: 10 },
    { header: '기사 이름', key: 'driverName', width: 12 },
    { header: '사원번호', key: 'employeeId', width: 12 },
    { header: '구분', key: 'driverType', width: 8 },
    { header: '버스번호', key: 'busNumber', width: 10 },
    { header: '근무형태', key: 'shift', width: 10 },
    { header: '상태', key: 'status', width: 8 },
  ];

  // Style header
  const dailyHeaderRow = dailySheet.getRow(1);
  dailyHeaderRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  });
  dailyHeaderRow.height = 24;

  for (const slot of schedule.slots) {
    if (slot.isRestDay) continue;

    const date = new Date(slot.date);
    // 슬롯은 UTC 자정으로 저장되므로 UTC 기준 날짜/요일을 사용해야 1일이 밀리지 않음
    const dayOfWeek = DAYS_KR[date.getUTCDay()];

    const row = dailySheet.addRow({
      date: `${year}.${String(month).padStart(2, '0')}.${String(date.getUTCDate()).padStart(2, '0')}`,
      day: dayOfWeek,
      route: slot.route?.routeNumber || '-',
      driverName: slot.driver.name,
      employeeId: slot.driver.employeeId,
      driverType: slot.driver.driverType === 'MAIN' ? '메인' : slot.driver.driverType === 'SPARE' ? '스페어' : '-',
      busNumber: slot.bus?.busNumber || '-',
      shift: SHIFT_LABELS[slot.shift] || slot.shift,
      status: getStatusLabel(slot.status),
    });

    row.eachCell(cell => {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    if (date.getUTCDay() === 0) {
      row.eachCell(cell => { cell.font = { color: { argb: 'FFCC0000' } }; });
    } else if (date.getUTCDay() === 6) {
      row.eachCell(cell => { cell.font = { color: { argb: 'FF0000CC' } }; });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    SCHEDULED: '정상',
    DROPPED: '드랍',
    FILLED: '대체',
    COMPLETED: '완료',
    ABSENT: '결근',
  };
  return labels[status] || status;
}
