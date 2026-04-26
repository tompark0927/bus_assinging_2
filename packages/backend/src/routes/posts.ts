import { Router } from 'express';
import {
  getPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  getPostReads,
} from '../controllers/postController';
import { authenticate, requireOfficeStaff } from '../middleware/auth';
import { postValidation } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.get('/', getPosts);
router.get('/:id', ...postValidation.getById, getPost);
router.post('/', ...postValidation.create, createPost);
router.put('/:id', ...postValidation.update, updatePost);
router.delete('/:id', ...postValidation.delete, deletePost);
router.get('/:id/reads', requireOfficeStaff, ...postValidation.getReads, getPostReads);

export default router;
