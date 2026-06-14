-- AlterTable
ALTER TABLE "Newsletter" ADD COLUMN     "failedRecipients" JSONB NOT NULL DEFAULT '[]';

