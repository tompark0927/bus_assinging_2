import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { analyzeExcel, confirmImport, downloadTemplate } from '../controllers/onboardingController';
import { onboardingValidation } from '../middleware/validate';

const router = Router();

// 메모리 스토리지 (파일을 디스크에 저장하지 않음)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
      'application/vnd.ms-excel', // xls
      'application/octet-stream',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
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
