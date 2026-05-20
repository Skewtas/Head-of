-- CreateEnum
CREATE TYPE "OpsPeriodType" AS ENUM ('YEAR', 'MONTH', 'WEEK');

-- CreateEnum
CREATE TYPE "OpsTaskSection" AS ENUM ('PIPELINE', 'ACTION', 'PERSONAL');

-- CreateEnum
CREATE TYPE "OpsTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "ops_goals" (
    "id" SERIAL NOT NULL,
    "period_type" "OpsPeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "metric_key" TEXT NOT NULL,
    "metric_label" TEXT NOT NULL,
    "target_value" DOUBLE PRECISION NOT NULL,
    "actual_override" DOUBLE PRECISION,
    "unit" TEXT,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_tasks" (
    "id" SERIAL NOT NULL,
    "section" "OpsTaskSection" NOT NULL,
    "owner" TEXT,
    "title" TEXT NOT NULL,
    "next_step" TEXT,
    "related_to" TEXT,
    "status" "OpsTaskStatus" NOT NULL DEFAULT 'OPEN',
    "deadline" DATE,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ops_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ops_goals_period_type_period_start_idx" ON "ops_goals"("period_type", "period_start");

-- CreateIndex
CREATE INDEX "ops_goals_metric_key_idx" ON "ops_goals"("metric_key");

-- CreateIndex
CREATE INDEX "ops_tasks_section_status_idx" ON "ops_tasks"("section", "status");

-- CreateIndex
CREATE INDEX "ops_tasks_owner_idx" ON "ops_tasks"("owner");

