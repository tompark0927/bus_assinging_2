-- 이력 수리: RefreshToken은 원래 어떤 마이그레이션에도 CREATE가 없었다
-- (프로덕션은 db push로 생성됨). 새 DB에서 migrate deploy가 여기서 터지므로
-- family 없는 원형 스키마를 멱등 생성한다. 이미 적용된 DB에선 이 마이그레이션이
-- 재실행되지 않으므로 프로덕션에는 영향 없음.
CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_token_key" ON "RefreshToken"("token");
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'RefreshToken_userId_fkey'
    ) THEN
        ALTER TABLE "RefreshToken"
            ADD CONSTRAINT "RefreshToken_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable: Add family column for refresh token rotation replay detection
-- First, delete all existing refresh tokens (they lack the family field and will be invalid after rotation is enforced)
DELETE FROM "RefreshToken";

-- Add the family column (NOT NULL since all old rows are deleted)
ALTER TABLE "RefreshToken" ADD COLUMN "family" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");
