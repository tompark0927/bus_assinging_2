import { Router } from 'express';
import { getGoldenTickets, useGoldenTicket } from '../controllers/goldenTicketController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/', getGoldenTickets);
router.post('/:id/use', useGoldenTicket);

export default router;
