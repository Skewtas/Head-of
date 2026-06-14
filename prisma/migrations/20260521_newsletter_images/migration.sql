-- CreateTable
CREATE TABLE "newsletter_images" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_images_pkey" PRIMARY KEY ("id")
);

