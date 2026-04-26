import { Request, Response } from 'express';
import logger from '../utils/logger';

export const reportError = async (req: Request, res: Response) => {
  const { message, stack, componentStack, url, userAgent, userId, timestamp } = req.body;

  if (!message) {
    res.status(400).json({ success: false, message: 'message is required' });
    return;
  }

  logger.error('Frontend Error Report', {
    source: 'frontend',
    message,
    stack,
    componentStack,
    url,
    userAgent,
    userId,
    timestamp,
  });

  res.json({ success: true });
};
