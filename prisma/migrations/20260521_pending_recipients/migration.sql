-- AlterTable
ALTER TABLE "Newsletter" ADD COLUMN     "pendingRecipients" JSONB NOT NULL DEFAULT '[]';

