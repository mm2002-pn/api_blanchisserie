-- CreateTable
CREATE TABLE "LinenCategoryConfig" (
    "id" TEXT NOT NULL,
    "code" "LinenCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinenCategoryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinenCategoryConfig_code_key" ON "LinenCategoryConfig"("code");
