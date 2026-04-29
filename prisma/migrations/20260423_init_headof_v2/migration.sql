-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PRIVATE', 'COMPANY');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'PAUSED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PriceModel" AS ENUM ('HOURLY', 'FIXED', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "InvoiceMethod" AS ENUM ('EMAIL', 'POST', 'E_INVOICE');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('INVOICE', 'SERVICE');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'BLOCKER');

-- CreateEnum
CREATE TYPE "AlertCategory" AS ENUM ('ECONOMY', 'CREDIT', 'PAYMENT', 'BEHAVIOR', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'HOURLY', 'SUBCONTRACTOR');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RutCategory" AS ENUM ('NONE', 'HOUSEHOLD', 'WINDOW', 'MOVING', 'GARDENING');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'QUOTED', 'ACTIVE', 'PAUSED', 'TERMINATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AgreementLineStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "PriceRule" AS ENUM ('HOURLY', 'FIXED_PER_VISIT', 'INCLUDED_IN_MONTHLY');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "DeviationType" AS ENUM ('NONE', 'LATE', 'EARLY_END', 'EXTRA_WORK', 'CUSTOMER_ABSENT', 'CANCELLED_ONSITE', 'SICK_DURING', 'EQUIPMENT_FAILURE');

-- CreateEnum
CREATE TYPE "ExtraType" AS ENUM ('SERVICE', 'MATERIAL', 'OUTLAY');

-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('SICK', 'VACATION', 'PARENTAL', 'VAB', 'COMP_TIME', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'SENT_TO_FORTNOX', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceLineSource" AS ENUM ('MISSION', 'EXTRA', 'MANUAL', 'SUBSCRIPTION_FEE', 'CANCELLATION_FEE');

-- CreateEnum
CREATE TYPE "PayrollLineType" AS ENUM ('REGULAR', 'OB_EVENING', 'OB_NIGHT', 'OB_WEEKEND', 'OB_HOLIDAY', 'OVERTIME', 'TRAVEL', 'OUTLAY', 'ABSENCE_SICK', 'ABSENCE_VACATION');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('COMPLAINT', 'QUESTION', 'FOLLOWUP', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "NoteResourceType" AS ENUM ('CLIENT', 'AGREEMENT', 'AGREEMENT_LINE', 'MISSION', 'EMPLOYEE', 'INVOICE', 'TICKET');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('OUT', 'IN');

-- CreateTable
CREATE TABLE "teams" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "region_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "clerk_user_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "personal_number" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'HOURLY',
    "base_hourly_rate_cents" INTEGER NOT NULL DEFAULT 0,
    "ob_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "primary_team_id" INTEGER,
    "home_lat" DOUBLE PRECISION,
    "home_lng" DOUBLE PRECISION,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fortnox_employee_id" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_teams" (
    "employee_id" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "employee_teams_pkey" PRIMARY KEY ("employee_id","team_id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" SERIAL NOT NULL,
    "client_number" TEXT NOT NULL,
    "type" "ClientType" NOT NULL DEFAULT 'PRIVATE',
    "name" TEXT NOT NULL,
    "org_number" TEXT,
    "personal_number" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "preferred_communication" TEXT,
    "rut_eligible" BOOLEAN NOT NULL DEFAULT false,
    "rut_share" DOUBLE PRECISION,
    "rut_personal_number" TEXT,
    "price_model" "PriceModel" NOT NULL DEFAULT 'HOURLY',
    "fortnox_customer_id" TEXT,
    "invoice_method" "InvoiceMethod" NOT NULL DEFAULT 'EMAIL',
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_addresses" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "type" "AddressType" NOT NULL,
    "street" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "door_code" TEXT,
    "parking_info" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "client_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_alerts" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "category" "AlertCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_alert_acknowledgements" (
    "id" SERIAL NOT NULL,
    "alert_id" INTEGER NOT NULL,
    "user_clerk_id" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_alert_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_minutes" INTEGER NOT NULL DEFAULT 60,
    "default_hourly_rate_cents" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "rut_category" "RutCategory" NOT NULL DEFAULT 'NONE',
    "fortnox_article_id" TEXT,
    "is_billable" BOOLEAN NOT NULL DEFAULT true,
    "is_payable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" SERIAL NOT NULL,
    "agreement_number" TEXT NOT NULL,
    "client_id" INTEGER NOT NULL,
    "team_id" INTEGER,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "valid_from" DATE,
    "valid_to" DATE,
    "invoice_address_id" INTEGER,
    "service_address_id" INTEGER,
    "payment_terms_days" INTEGER,
    "cancellation_policy_hours" INTEGER NOT NULL DEFAULT 24,
    "cancellation_fee_percent" INTEGER NOT NULL DEFAULT 50,
    "internal_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_lines" (
    "id" SERIAL NOT NULL,
    "agreement_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "rrule" TEXT NOT NULL,
    "default_start_time" TEXT NOT NULL,
    "default_duration_minutes" INTEGER NOT NULL,
    "planned_crew_size" INTEGER NOT NULL DEFAULT 1,
    "preferred_employee_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "price_rule" "PriceRule" NOT NULL DEFAULT 'HOURLY',
    "hourly_rate_cents" INTEGER,
    "fixed_price_cents" INTEGER,
    "status" "AgreementLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "valid_from" DATE,
    "valid_to" DATE,
    "customer_instructions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" SERIAL NOT NULL,
    "agreement_line_id" INTEGER,
    "client_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "team_id" INTEGER,
    "date" DATE NOT NULL,
    "planned_start" TIMESTAMP(3) NOT NULL,
    "planned_end" TIMESTAMP(3) NOT NULL,
    "planned_crew_size" INTEGER NOT NULL DEFAULT 1,
    "planned_duration_minutes" INTEGER NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'PLANNED',
    "cancellation_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "billable_cancellation" BOOLEAN NOT NULL DEFAULT false,
    "customer_instructions" TEXT,
    "internal_notes" TEXT,
    "rrule_instance_date" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_assignments" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "role" "AssignmentRole" NOT NULL DEFAULT 'MEMBER',
    "planned_start" TIMESTAMP(3) NOT NULL,
    "planned_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "check_in_at" TIMESTAMP(3),
    "check_out_at" TIMESTAMP(3),
    "check_in_lat" DOUBLE PRECISION,
    "check_in_lng" DOUBLE PRECISION,
    "check_out_lat" DOUBLE PRECISION,
    "check_out_lng" DOUBLE PRECISION,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "actual_minutes" INTEGER,
    "deviation_type" "DeviationType" NOT NULL DEFAULT 'NONE',
    "deviation_note" TEXT,
    "employee_approved_at" TIMESTAMP(3),
    "admin_approved_at" TIMESTAMP(3),
    "admin_approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_extras" (
    "id" SERIAL NOT NULL,
    "mission_id" INTEGER NOT NULL,
    "time_entry_id" INTEGER,
    "type" "ExtraType" NOT NULL,
    "service_id" INTEGER,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "payable_to_employee_id" INTEGER,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_extras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "type" "AbsenceType" NOT NULL,
    "affects_missions" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "agreement_id" INTEGER,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "rut_cents" INTEGER NOT NULL DEFAULT 0,
    "vat_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "invoice_method" "InvoiceMethod" NOT NULL DEFAULT 'EMAIL',
    "fortnox_invoice_id" TEXT,
    "fortnox_invoice_number" TEXT,
    "sent_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "reviewed_by" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "source_type" "InvoiceLineSource" NOT NULL,
    "mission_id" INTEGER,
    "mission_extra_id" INTEGER,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "line_total_cents" INTEGER NOT NULL,
    "rut_eligible" BOOLEAN NOT NULL DEFAULT false,
    "rut_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "fortnox_article_id" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "type" "PayrollLineType" NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "rate_cents" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "source_time_entry_id" INTEGER,
    "description" TEXT,
    "sent_to_fortnox_at" TIMESTAMP(3),
    "fortnox_payroll_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER,
    "agreement_id" INTEGER,
    "mission_id" INTEGER,
    "type" "TicketType" NOT NULL DEFAULT 'COMPLAINT',
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "assignee_employee_id" INTEGER,
    "reporter" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" SERIAL NOT NULL,
    "resource_type" "NoteResourceType" NOT NULL,
    "resource_id" INTEGER NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fortnox_sync_log" (
    "id" SERIAL NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "http_status" INTEGER,
    "payload" JSONB,
    "response" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fortnox_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "actor_clerk_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_clerk_user_id_key" ON "employees"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE UNIQUE INDEX "clients_client_number_key" ON "clients"("client_number");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_name_idx" ON "clients"("name");

-- CreateIndex
CREATE INDEX "client_addresses_client_id_idx" ON "client_addresses"("client_id");

-- CreateIndex
CREATE INDEX "client_alerts_client_id_active_idx" ON "client_alerts"("client_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "client_alert_acknowledgements_alert_id_user_clerk_id_key" ON "client_alert_acknowledgements"("alert_id", "user_clerk_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_name_key" ON "services"("name");

-- CreateIndex
CREATE UNIQUE INDEX "agreements_agreement_number_key" ON "agreements"("agreement_number");

-- CreateIndex
CREATE INDEX "agreements_client_id_idx" ON "agreements"("client_id");

-- CreateIndex
CREATE INDEX "agreements_status_idx" ON "agreements"("status");

-- CreateIndex
CREATE INDEX "agreement_lines_agreement_id_idx" ON "agreement_lines"("agreement_id");

-- CreateIndex
CREATE INDEX "agreement_lines_status_idx" ON "agreement_lines"("status");

-- CreateIndex
CREATE INDEX "missions_date_status_idx" ON "missions"("date", "status");

-- CreateIndex
CREATE INDEX "missions_team_id_date_idx" ON "missions"("team_id", "date");

-- CreateIndex
CREATE INDEX "missions_client_id_date_idx" ON "missions"("client_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "missions_agreement_line_id_rrule_instance_date_key" ON "missions"("agreement_line_id", "rrule_instance_date");

-- CreateIndex
CREATE INDEX "mission_assignments_employee_id_planned_start_idx" ON "mission_assignments"("employee_id", "planned_start");

-- CreateIndex
CREATE UNIQUE INDEX "mission_assignments_mission_id_employee_id_key" ON "mission_assignments"("mission_id", "employee_id");

-- CreateIndex
CREATE INDEX "time_entries_employee_id_check_in_at_idx" ON "time_entries"("employee_id", "check_in_at");

-- CreateIndex
CREATE INDEX "time_entries_admin_approved_at_idx" ON "time_entries"("admin_approved_at");

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_mission_id_employee_id_key" ON "time_entries"("mission_id", "employee_id");

-- CreateIndex
CREATE INDEX "mission_extras_mission_id_idx" ON "mission_extras"("mission_id");

-- CreateIndex
CREATE INDEX "absences_employee_id_from_date_to_date_idx" ON "absences"("employee_id", "from_date", "to_date");

-- CreateIndex
CREATE INDEX "invoices_client_id_period_start_idx" ON "invoices"("client_id", "period_start");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "payroll_lines_employee_id_period_start_idx" ON "payroll_lines"("employee_id", "period_start");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_client_id_idx" ON "tickets"("client_id");

-- CreateIndex
CREATE INDEX "ticket_comments_ticket_id_idx" ON "ticket_comments"("ticket_id");

-- CreateIndex
CREATE INDEX "notes_resource_type_resource_id_idx" ON "notes"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "fortnox_sync_log_entity_type_entity_id_created_at_idx" ON "fortnox_sync_log"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_at_idx" ON "audit_log"("entity_type", "entity_id", "at" DESC);

-- AddForeignKey
ALTER TABLE "employee_teams" ADD CONSTRAINT "employee_teams_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_teams" ADD CONSTRAINT "employee_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_addresses" ADD CONSTRAINT "client_addresses_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_alerts" ADD CONSTRAINT "client_alerts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_alert_acknowledgements" ADD CONSTRAINT "client_alert_acknowledgements_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "client_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_invoice_address_id_fkey" FOREIGN KEY ("invoice_address_id") REFERENCES "client_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_service_address_id_fkey" FOREIGN KEY ("service_address_id") REFERENCES "client_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_lines" ADD CONSTRAINT "agreement_lines_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_lines" ADD CONSTRAINT "agreement_lines_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_agreement_line_id_fkey" FOREIGN KEY ("agreement_line_id") REFERENCES "agreement_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_extras" ADD CONSTRAINT "mission_extras_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_extras" ADD CONSTRAINT "mission_extras_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_extras" ADD CONSTRAINT "mission_extras_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_mission_extra_id_fkey" FOREIGN KEY ("mission_extra_id") REFERENCES "mission_extras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_employee_id_fkey" FOREIGN KEY ("assignee_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

