-- AlterTable
ALTER TABLE "Newsletter" ADD COLUMN     "dailyReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dailyReminderLastSentAt" TIMESTAMP(3),
ADD COLUMN     "dailyReminderUntil" TIMESTAMP(3);

