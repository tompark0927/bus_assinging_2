import { Router } from 'express';
import { globalSearch } from '../controllers/searchController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// GET /api/v1/search?q=검색어
router.get('/', globalSearch);

export default router;
