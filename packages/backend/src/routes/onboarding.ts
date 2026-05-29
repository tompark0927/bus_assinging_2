import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { analyzeExcel, confirmImport, downloadTemplate } from '../controllers/onboardingController';
import { onboardingValidation } from '../middleware/validate';

const router = Router();

// 메모리 스토리지 (파일을 디스크에 저장하지 않음 → path traversal/디스크 어택 방지)
//
// 보안 강화 fileFilter:
//   1. 파일 확장자가 .xlsx / .xls 여야 함 (대소문자 무시)
//   2. mimetype 이 합법 Excel MIME 또는 octet-stream 이어야 함
//      (브라우저별 mimetype 차이 때문에 octet-stream 도 허용하되 확장자는 반드시 매칭)
//   3. 추가 limits: 1 파일만, 필드 1개만 → DoS 방지
//
// 둘 다 통과해야 허용 (mimetype OR 확장자 만으로는 부족 — spoof 가능).
const ALLOWED_EXCEL_MIMETYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/octet-stream', // 일부 브라우저 (Safari/Edge) 의 보수적 추론
]);
const EXCEL_FILENAME_RE = /^[^/\\]+\.(xlsx|xls)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1, // 단일 파일만
    fields: 5, // 첨부 메타 필드 최소만 허용
    headerPairs: 30,
  },
  fileFilter: (_req, file, cb) => {
    const mimeOk = ALLOWED_EXCEL_MIMETYPES.has(file.mimetype);
    const nameOk = EXCEL_FILENAME_RE.test(file.originalname);
    if (mimeOk && nameOk) {
      cb(null, true);
    } else {
      cb(new Error('엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.'));
    }
  },
});

// 엑셀 템플릿 다운로드
router.get('/template', authenticate, downloadTemplate);

// 엑셀 분석 (AI)
router.post('/analyze-excel', authenticate, upload.single('file'), analyzeExcel);

// 분석 결과 확인 후 DB 저장
router.post('/confirm-import', authenticate, ...onboardingValidation.confirmImport, confirmImport);

export default router;
