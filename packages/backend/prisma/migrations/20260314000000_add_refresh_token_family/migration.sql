-- AlterTable: Add family column for refresh token rotation replay detection
-- First, delete all existing refresh tokens (they lack the family field and will be invalid after rotation is enforced)
DELETE FROM "RefreshToken";

-- Add the family column (NOT NULL since all old rows are deleted)
ALTER TABLE "RefreshToken" ADD COLUMN "family" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");
