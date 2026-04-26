// 테스트 환경 환경변수 설정 (validateEnv 통과용)
process.env.DATABASE_URL = 'postgresql://busync:your_secure_password_here@localhost:5432/busync_test';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum_length_ok';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.NODE_ENV = 'test';
