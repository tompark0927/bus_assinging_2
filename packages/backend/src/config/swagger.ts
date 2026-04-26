import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Busync 배차관리 시스템 API',
      version: '1.0.0',
      description: '버스 배차, 근태, 급여, 안전관리 등 통합 관리 시스템 API 문서',
    },
    servers: [
      { url: '/api/v1', description: '기본 API 서버' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
